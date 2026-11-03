import { useEffect, useRef } from 'react';
import {
  registerAiWorkspace,
  invokeAiDesign,
  cancelAiDesignRequests,
  type AiMode,
  type AiWorkspace,
} from './ai-design';
export function useAiWorkspace(mode: AiMode, workspace: AiWorkspace) {
  const latest = useRef(workspace);
  latest.current = workspace;
  const state = useRef(workspace.read());
  state.current = workspace.read();
  useEffect(
    () =>
      registerAiWorkspace(mode, {
        read: () => state.current,
        write: (next, fresh) => {
          state.current = next;
          latest.current.write(next, fresh);
        },
        busy: () => latest.current.busy(),
        resolveEditor: async (action, operationId) => {
          if (!latest.current.resolveEditor) throw Error('Resolve this operation in the app.');
          await latest.current.resolveEditor(action, operationId);
        },
        editorState: () =>
          latest.current.editorState?.() ?? {
            operation: latest.current.busy() ? 'Editor operation in progress' : null,
          },
        open: (fresh) => latest.current.open(fresh),
        beforeReplace: () => latest.current.beforeReplace?.() ?? Promise.resolve(),
        undo: () => latest.current.undo(),
        redo: () => latest.current.redo(),
      }),
    [mode],
  );
}
export function useAiDesignBridge() {
  useEffect(() => window.skarix?.ai?.onCancel(cancelAiDesignRequests), []);
  useEffect(
    () =>
      window.skarix?.ai?.onRequest(async (request) => {
        try {
          return { value: await invokeAiDesign(request.name, request.args) };
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'Design operation failed.' };
        }
      }),
    [],
  );
}
