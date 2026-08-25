'use client';

import { Component, useEffect, useRef, type ReactNode } from 'react';

import { ErrorText } from '@/components/ui/error-text';
import { FieldWorkPackLoadError } from '@/components/auftraege/field-work-pack-load-error';

type FieldWorkPackSourceProps = {
  sourceId: string;
  success: boolean;
  title: string;
  description: string;
  children: ReactNode;
};

type FieldWorkPackSourceState = { sourceId: string; lastKnown: ReactNode };

function ReadOnlyStaleContent({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interactiveElements = containerRef.current?.querySelectorAll<HTMLElement>(
      'a, button, input, select, textarea, [role="button"], [tabindex]'
    );
    interactiveElements?.forEach((element) => {
      element.setAttribute('aria-disabled', 'true');
      element.setAttribute('tabindex', '-1');
      if (
        element instanceof HTMLButtonElement ||
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
      ) {
        element.disabled = true;
      }
    });
  }, [children]);

  return (
    <div
      ref={containerRef}
      aria-disabled="true"
      className="pointer-events-none opacity-70"
      onClickCapture={(event) => event.preventDefault()}
      onSubmitCapture={(event) => event.preventDefault()}
      onKeyDownCapture={(event) => event.preventDefault()}
    >
      {children}
    </div>
  );
}

export class FieldWorkPackSource extends Component<
  FieldWorkPackSourceProps,
  FieldWorkPackSourceState
> {
  state: FieldWorkPackSourceState = {
    sourceId: this.props.sourceId,
    lastKnown: this.props.success ? this.props.children : null,
  };

  static getDerivedStateFromProps(
    props: FieldWorkPackSourceProps,
    state: FieldWorkPackSourceState
  ): FieldWorkPackSourceState | null {
    if (props.sourceId !== state.sourceId) {
      return {
        sourceId: props.sourceId,
        lastKnown: props.success ? props.children : null,
      };
    }
    if (props.success && props.children !== state.lastKnown) {
      return { ...state, lastKnown: props.children };
    }
    return null;
  }

  render() {
    const { success, title, description, children } = this.props;
    const { lastKnown } = this.state;

    if (success) return children;
    if (!lastKnown) return <FieldWorkPackLoadError title={title} description={description} />;

    return (
      <div className="space-y-3">
        <div className="rounded-md border bg-muted/30 px-3 py-2" role="status">
          <ErrorText>
            {description} Der letzte geladene Stand bleibt sichtbar und kann veraltet sein.
          </ErrorText>
        </div>
        <ReadOnlyStaleContent>{lastKnown}</ReadOnlyStaleContent>
      </div>
    );
  }
}
