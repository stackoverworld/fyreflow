import {
  type UseCanvasKeyboardOptions,
  useCanvasKeyboard
} from "./useCanvasKeyboard";

export type { UseCanvasKeyboardOptions };

export function usePipelineCanvasKeyboard(options: UseCanvasKeyboardOptions): void {
  useCanvasKeyboard(options);
}

