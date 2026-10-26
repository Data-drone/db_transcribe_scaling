import { createApp, analytics, files, genie, lakebase, server } from '@databricks/appkit';
import { AUDIO_VOLUME_ROOT, audioFilesConfiguration, createAudioHandler } from './investigations/audio';
import { registerInvestigationRoutes } from './investigations/routes';
import { createSourceReader } from './investigations/sources';
import { createLakebaseDocumentStore, initializeAppState, requestActor, respondError } from './investigations/storage';
import { createInsightsQueries, registerInsightsRoutes } from './insights/routes';
import { registerIntelligenceRoutes } from './intelligence/routes';
import { createLabelJobRunner } from './intelligence/worker';

createApp({
  plugins: [
    analytics(),
    lakebase(),
    genie(),
    files(audioFilesConfiguration()),
    server(),
  ],
  async onPluginsReady(appkit) {
    if (process.env.DATABRICKS_VOLUME_AUDIO !== AUDIO_VOLUME_ROOT) {
      throw new Error('The original-audio volume must match the configured source corpus.');
    }
    await initializeAppState(appkit.lakebase);
    const store = createLakebaseDocumentStore(appkit.lakebase);
    const sources = createSourceReader(appkit);
    const insights = createInsightsQueries(appkit);
    appkit.server.extend((app) => {
      app.get('/api/whoami', (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        try {
          const actor = requestActor(req);
          res.json({ email: actor.email, user: actor.id });
        } catch (error) {
          respondError(res, error);
        }
      });
      registerInsightsRoutes(app, insights);
      registerInvestigationRoutes(app, store, sources);
      app.get(
        '/api/calls/:interactionId/audio',
        createAudioHandler(sources, (req, path) => appkit.asUser(req).files('audio').download(path))
      );
    });
    registerIntelligenceRoutes(appkit, store, createLabelJobRunner());
  },
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
