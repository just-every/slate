import { contentLimits } from './limits';
import { ApiProblem } from '../../app/problems';
import { sanitizeSvg } from '../media/sanitize';
import { parse } from 'parse5';

/** link.preview.v1: the only outbound boundary used by pasted link cards. */
export interface PreviewTransport {
    resolve(hostname: string): Promise<string[]>;
    get(url: string, options: { signal: AbortSignal }): Promise<Response>;
}
export function publicIp(address: string) {
    const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
    if (ip.includes(':')) {
        const [first, second] = ip.split(':');
        const prefix = parseInt(first!, 16), subnet = parseInt(second || '0', 16);
        return /^[0-9a-f:]+$/.test(ip) && prefix >= 0x2000 && prefix < 0x4000
            && !(prefix === 0x2001 && (subnet < 0x200 || subnet === 0xdb8))
            && !/^2002:|^3fff:/.test(ip);
    }
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
    const parts = ip.split('.').map(Number);
    if (parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return false;
    const [a, b] = parts;
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b! >= 16 && b! <= 31 || a === 192 && (b === 168 || b === 0 || b === 2) || a === 198 && (b === 18 || b === 19 || b === 51) || a === 203 && b === 0 || a! >= 224 || a === 100 && b! >= 64 && b! <= 127);
}
async function allowed(raw: string, transport: PreviewTransport) {
    let u: URL;
    try { u = new URL(raw); } catch { throw new ApiProblem(400, 'PREVIEW_REFUSED', 'Only public HTTPS URLs are previewed.'); }
    const hostname = u.hostname.replace(/^\[|\]$/g, '');
    if (u.protocol !== 'https:' || u.username || u.password || u.port || /(^|\.)(localhost|local|internal)\.?$/i.test(hostname) || (!hostname.includes('.') && !hostname.includes(':')))
        throw new ApiProblem(400, 'PREVIEW_REFUSED', 'Only public HTTPS URLs are previewed.');
    const addresses = /^[\d.]+$/.test(hostname) || hostname.includes(':') ? [hostname] : await transport.resolve(hostname);
    if (!addresses.length || addresses.some(a => !publicIp(a)))
        throw new ApiProblem(400, 'PREVIEW_REFUSED', 'Private and local destinations cannot be previewed.');
    return u;
}
const iconTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml'];
export async function previewLink(raw: string, transport: PreviewTransport) {
    const controller = new AbortController();
    let rejectDeadline: (error: unknown) => void = () => {};
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
    const timer = setTimeout(() => {
        controller.abort();
        rejectDeadline(new ApiProblem(400, 'PREVIEW_REFUSED', 'Preview exceeds the time limit.'));
    }, contentLimits.maximumUrlFetchSeconds * 1000);
    const budget = { bytes: 0, redirects: 0 };
    async function read(rawUrl: string, mediaTypes: readonly string[]) {
        let url = await allowed(rawUrl, transport);
        while (true) {
            controller.signal.throwIfAborted();
            const response = await transport.get(url.href, { signal: controller.signal });
            if (response.status >= 300 && response.status < 400) {
                await response.body?.cancel();
                const location = response.headers.get('location');
                if (!location || budget.redirects++ >= contentLimits.maximumUrlFetchRedirects)
                    throw new ApiProblem(400, 'PREVIEW_REFUSED', 'Too many redirects.');
                url = await allowed(new URL(location, url).href, transport);
                continue;
            }
            const mediaType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
            if (!response.ok || !mediaTypes.includes(mediaType)) {
                await response.body?.cancel();
                throw new ApiProblem(400, 'PREVIEW_FAILED', 'The destination did not return a supported preview.');
            }
            if (Number(response.headers.get('content-length')) + budget.bytes > contentLimits.maximumUrlFetchBytes) {
                await response.body?.cancel();
                throw new ApiProblem(400, 'PREVIEW_REFUSED', 'Preview exceeds the size limit.');
            }
            const reader = response.body?.getReader();
            if (!reader) throw new ApiProblem(400, 'PREVIEW_FAILED', 'Empty response.');
            const abort = () => { void reader.cancel().catch(() => {}); };
            controller.signal.addEventListener('abort', abort, { once: true });
            const chunks: Uint8Array[] = [];
            let size = 0;
            try {
                while (true) {
                    const part = await reader.read();
                    controller.signal.throwIfAborted();
                    if (part.done) break;
                    budget.bytes += part.value.byteLength;
                    if (budget.bytes > contentLimits.maximumUrlFetchBytes)
                        throw new ApiProblem(400, 'PREVIEW_REFUSED', 'Preview exceeds the size limit.');
                    chunks.push(part.value); size += part.value.byteLength;
                }
            } finally {
                controller.signal.removeEventListener('abort', abort);
                await reader.cancel();
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            return { url, mediaType, bytes };
        }
    }
    async function run() {
        const response = await read(raw, contentLimits.allowedFetchMediaTypes);
        const doc = parse(new TextDecoder().decode(response.bytes));
        let title = '', description = '', iconHref = '';
        function visit(node: any) {
            const attrs = Object.fromEntries((node.attrs ?? []).map((a: any) => [a.name, a.value]));
            if (node.tagName === 'title') title = (node.childNodes ?? []).map((x: any) => x.value ?? '').join('');
            if (node.tagName === 'meta' && (attrs.name?.toLowerCase() === 'description' || attrs.property?.toLowerCase() === 'og:description')) description = attrs.content ?? description;
            if (node.tagName === 'link' && attrs.rel?.toLowerCase().split(/\s+/).includes('icon') && !iconHref) iconHref = attrs.href ?? '';
            for (const child of node.childNodes ?? []) visit(child);
        }
        visit(doc);
        let iconData: string | undefined;
        if (iconHref) {
            try {
                const icon = await read(new URL(iconHref, response.url).href, iconTypes);
                const bytes = icon.mediaType === 'image/svg+xml' ? new TextEncoder().encode(sanitizeSvg(new TextDecoder().decode(icon.bytes))) : icon.bytes;
                let binary = '';
                for (const byte of bytes) binary += String.fromCharCode(byte);
                iconData = `data:${icon.mediaType};base64,${btoa(binary)}`;
            } catch (error) {
                // A rejected icon must not turn a safe title and description into a remote browser request.
                if (controller.signal.aborted) throw error;
            }
        }
        return { url: raw, previewState: 'ready' as const, display: 'card' as const, preview: { title: title.slice(0, 500) || response.url.hostname, description: description.slice(0, 2000), ...(iconData ? {iconData} : {}) } };
    }
    try { return await Promise.race([run(), deadline]); }
    catch (error) {
        if (error instanceof ApiProblem) throw error;
        throw new ApiProblem(400, 'PREVIEW_FAILED', 'A preview could not be fetched, so the link is shown as written.');
    } finally { clearTimeout(timer); }
}
/** DNS and target requests are anonymous, bodyless and never follow redirects automatically. */
export const publicPreviewTransport: PreviewTransport = {
    async resolve(hostname) {
        const results = await Promise.all(['A', 'AAAA'].map(async type => {
            const u = new URL('https://cloudflare-dns.com/dns-query');
            u.searchParams.set('name', hostname); u.searchParams.set('type', type);
            const r = await fetch(u, { method: 'GET', credentials: 'omit', headers: { accept: 'application/dns-json' }, redirect: 'manual', signal: AbortSignal.timeout(3000) });
            if (!r.ok) throw new ApiProblem(503, 'DNS_UNAVAILABLE', 'Preview DNS lookup is unavailable.');
            const d = await r.json<{ Answer?: { type: number; data: string }[] }>();
            return (d.Answer ?? []).filter(a => a.type === 1 || a.type === 28).map(a => a.data);
        }));
        return results.flat();
    },
    get(url, { signal }) { return fetch(url, { method: 'GET', redirect: 'manual', credentials: 'omit', headers: { accept: 'text/html, image/*' }, signal }); }
};
