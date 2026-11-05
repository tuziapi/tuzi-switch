import {
  type PlaitTextBoard,
  type RenderComponentRef,
  type TextProps,
} from '@plait/common';
import type { PlaitBoard } from '@plait/core';
import { createRoot } from 'react-dom/client';
import { Text, type CustomEditor } from '@plait-board/react-text';
import { ReactEditor } from 'slate-react';
import { Node as SlateNode, Transforms } from 'slate';
import type { ReactBoard } from './board';

export const withReact = (board: PlaitBoard & PlaitTextBoard) => {
  const newBoard = board as PlaitBoard & PlaitTextBoard & ReactBoard;

  newBoard.renderText = (
    container: Element | DocumentFragment,
    props: TextProps
  ) => {
    const root = createRoot(container);
    let currentEditor: CustomEditor;
    let destroyed = false;
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    const clearFocusTimer = () => {
      if (focusTimer) {
        clearTimeout(focusTimer);
        focusTimer = undefined;
      }
    };
    const text = (
      <Text
        {...props}
        afterInit={(editor) => {
          currentEditor = editor as CustomEditor;
          props.afterInit && props.afterInit(currentEditor);
        }}
      ></Text>
    );
    root.render(text);
    let newProps = { ...props };
    const ref: RenderComponentRef<TextProps> = {
      destroy: () => {
        if (destroyed) {
          return;
        }
        destroyed = true;
        clearFocusTimer();
        setTimeout(() => {
          root.unmount();
        }, 0);
      },
      update: (updatedProps: Partial<TextProps>) => {
        if (destroyed) {
          return;
        }
        const hasUpdated =
          updatedProps &&
          newProps &&
          !Object.keys(updatedProps).every(
            (key) =>
              updatedProps[key as keyof TextProps] ===
              newProps[key as keyof TextProps]
          );
        if (!hasUpdated) {
          return;
        }
        const readonly = ReactEditor.isReadOnly(currentEditor);
        newProps = { ...newProps, ...updatedProps };
        root.render(<Text {...newProps}></Text>);

        if (readonly === true && newProps.readonly === false) {
          clearFocusTimer();
          focusTimer = setTimeout(() => {
            focusTimer = undefined;
            if (destroyed) {
              return;
            }
            ensureValidSelection(currentEditor);
            ReactEditor.focus(currentEditor);
          }, 0);
        } else if (readonly === false && newProps.readonly === true) {
          clearFocusTimer();
          ReactEditor.blur(currentEditor);
          ReactEditor.deselect(currentEditor);
        }
      },
    };
    return ref;
  };

  return newBoard;
};

const ensureValidSelection = (editor: CustomEditor) => {
  const { selection } = editor;
  if (!selection) {
    return;
  }
  if (
    SlateNode.has(editor, selection.anchor.path) &&
    SlateNode.has(editor, selection.focus.path)
  ) {
    return;
  }
  Transforms.deselect(editor);
};
