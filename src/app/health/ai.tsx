import { ModuleNoorAIScreen } from '@features/modules/noor-ai/module-noor-ai-screen';

/** `/health/ai` — Noor AI, opened from health (issue #64, Stage 1). */
export default function Screen() {
  return <ModuleNoorAIScreen moduleId="health" />;
}
