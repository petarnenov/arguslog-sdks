import { captureException } from '@arguslog/sdk-browser';
import { defineComponent, h, onErrorCaptured, ref, type PropType, type VNode } from 'vue';

type FallbackRenderArgs = { error: Error; reset: () => void };
type FallbackRender = (args: FallbackRenderArgs) => VNode | VNode[] | string;

export const ArguslogErrorBoundary = defineComponent({
  name: 'ArguslogErrorBoundary',
  props: {
    fallback: {
      type: [Function, Object, String] as PropType<FallbackRender | VNode | string>,
      required: true,
    },
    onError: {
      type: Function as PropType<(error: Error, info: string) => void>,
      default: undefined,
    },
  },
  setup(props, { slots, expose }) {
    const error = ref<Error | null>(null);

    const reset = (): void => {
      error.value = null;
    };

    expose({ reset });

    onErrorCaptured((err, _instance, info) => {
      const normalised = err instanceof Error ? err : new Error(String(err));
      error.value = normalised;
      captureException(normalised, { tags: { boundary: 'vue' } });
      props.onError?.(normalised, info);
      // Stop propagation — the boundary has handled the error.
      return false;
    });

    return () => {
      if (error.value) {
        const fb = props.fallback;
        if (typeof fb === 'function') {
          return (fb as FallbackRender)({ error: error.value, reset });
        }
        return fb as VNode | string;
      }
      return slots.default ? slots.default() : h('template');
    };
  },
});
