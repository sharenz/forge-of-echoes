// The Codex tab of the Cartography Table. The wheel, threads, tooltips and inspector live in src/ui/codex; this file keeps
// the panel-level entry point (`MapTreeView`) that MapDevice mounts.
import type { AtlasAreaId } from '../../contracts/atlas';
import { CodexView } from '../codex/Codex';

export function MapTreeView({ onBack, areaId }: { onBack: () => void; areaId?: AtlasAreaId }) {
  return <CodexView onBack={onBack} areaId={areaId} />;
}
