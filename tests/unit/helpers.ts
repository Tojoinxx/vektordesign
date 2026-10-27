import { createAppStore } from '../../src/store/state';
import { Editor } from '../../src/store/editor';
import { createSolver, type SketchSolver } from '../../src/solver/solver';

let shared: SketchSolver | null = null;

export async function solver(): Promise<SketchSolver> {
  if (!shared) shared = await createSolver();
  return shared;
}

export async function makeEditor(): Promise<Editor> {
  const store = createAppStore();
  const ed = new Editor(store);
  ed.attachSolver(await solver());
  return ed;
}
