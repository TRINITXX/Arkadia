import { useCallback, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  LayoutAnimation,
  type KeyboardEvent,
  type TextInputInstance,
  type TextInputKeyPressEvent,
} from "react-native";
import { typingDelta } from "@/mobile/typing";

const BACKSPACE = "\x7f";

/**
 * The hidden field the iPhone keyboard types through, so autocorrect and
 * dictation work: each change reaches Claude's prompt as backspaces down to
 * the first difference, then the new text (`typingDelta`, shared with the
 * web page). The keyboard opens only from its key, never from a tap.
 */
export function useTypingInput(send: (data: string) => boolean) {
  const ref = useRef<TextInputInstance>(null);
  const sent = useRef("");
  /** What the keyboard covers from the screen's bottom edge; 0 = closed. */
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // The screen makes room itself, moving with the keyboard: measured from the
  // bottom edge, it does not depend on where the header puts the screen.
  useEffect(() => {
    const follow = (e: KeyboardEvent, height: number) => {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(e.duration || 250, "keyboard", "opacity"),
      );
      setKeyboardHeight(height);
    };
    const show = Keyboard.addListener("keyboardWillShow", (e) =>
      follow(e, e.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardWillHide", (e) => follow(e, 0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const keyboardOpen = keyboardHeight > 0;

  /** Starts over: what the field held no longer matches the prompt. */
  const reset = useCallback(() => {
    sent.current = "";
    ref.current?.clear();
  }, []);

  const onChangeText = useCallback(
    (now: string) => {
      const delta = typingDelta(sent.current, now);
      sent.current = now;
      // Dropped while offline: the prompt never got it. Start over rather
      // than erase the wrong text later.
      if (delta && !send(delta)) reset();
    },
    [send, reset],
  );

  // Erasing past the field's start changes nothing in it: send it here.
  const onKeyPress = useCallback(
    (e: TextInputKeyPressEvent) => {
      if (e.nativeEvent.key === "Backspace" && sent.current === "")
        send(BACKSPACE);
    },
    [send],
  );

  const onSubmitEditing = useCallback(() => {
    send("\r");
    reset();
  }, [send, reset]);

  const toggleKeyboard = useCallback(() => {
    if (keyboardOpen) ref.current?.blur();
    else ref.current?.focus();
  }, [keyboardOpen]);

  return {
    ref,
    keyboardOpen,
    toggleKeyboard,
    reset,
    keyboardHeight,
    // Opening the keyboard starts from an empty field: what it held may no
    // longer be in the prompt (typed on the PC, a choice tapped meanwhile).
    fieldProps: { onChangeText, onKeyPress, onSubmitEditing, onFocus: reset },
  };
}
