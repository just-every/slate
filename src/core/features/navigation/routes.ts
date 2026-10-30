import { setFavourite } from './favourites';
import { containerWatchers, setContainerWatch } from './watches';
import { watchConfiguration, setWatchConfiguration, watchConfigurationSchema } from './watch-configuration';
import { following } from '../notifications/following';
import { navigationConfiguration, setNavigationConfiguration, navigationConfigurationSchema } from './configuration';
import { parseBody } from '../workspace/routes';
import { personalJson } from '../navigation/request';
import { Hono } from 'hono';
import type { AppEnvironment } from '../../app/types';
import { featureContext } from '../../app/feature-context';
import { navigation,preferences,updatePreferences,openRecent,setWatch } from './service';
export function createNavigationRoutes(){const app=new Hono<AppEnvironment>();app.use('*',personalJson);app.get('/following',async c=>c.json(await following(featureContext(c))));app.get('/watch-configuration',async c=>c.json(await watchConfiguration(featureContext(c))));app.put('/watch-configuration',async c=>c.json(await setWatchConfiguration(featureContext(c),await parseBody(c.req,watchConfigurationSchema))));app.get('/container-watches/:id',async c=>c.json(await containerWatchers(featureContext(c),c.req.param('id'))));app.put('/container-watches',async c=>c.json(await setContainerWatch(featureContext(c),await c.req.json())));app.get('/configuration',async c=>c.json(await navigationConfiguration(featureContext(c))));app.put('/configuration',async c=>c.json(await setNavigationConfiguration(featureContext(c),await parseBody(c.req,navigationConfigurationSchema))));app.get('/',async c=>c.json(await navigation(featureContext(c))));app.get('/preferences',async c=>c.json(await preferences(featureContext(c))));app.put('/preferences',async c=>c.json(await updatePreferences(featureContext(c),await c.req.json())));app.post('/recents',async c=>c.json(await openRecent(featureContext(c),await c.req.json())));app.put('/favourites',async c=>c.json(await setFavourite(featureContext(c),await c.req.json())));app.put('/watches',async c=>c.json(await setWatch(featureContext(c),await c.req.json())));return app;}
