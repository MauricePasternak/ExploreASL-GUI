import Paper, { PaperProps } from "@mui/material/Paper";
import FastIsEqual from "fast-deep-equal";
import Quill from "quill";
import "quill/dist/quill.snow.css";
import React, { useCallback, useEffect, useState } from "react";
import { MEDIAPROTOCOL, QUILLFONTFAMILIES, QUILLFONTSIZES } from "../../common/GLOBALS";
import { QuillFormat } from "../../common/types/quillExtraTypes";

function linkSanitize(url: string, protocols: unknown[]) {
  const anchor = document.createElement("a");
  anchor.href = url;
  const protocol = anchor.href.slice(0, anchor.href.indexOf(":"));
  return protocols.indexOf(protocol) > -1;
}

function defaultImageSanitize(url: string) {
  return linkSanitize(url, ["http", "https", "data"]) ? url : "//:0";
}

type IPCQuillProps = {
  channelName: string;
  defaultHeight?: string | number;
  scrollDownPerUpdate?: boolean;
} & PaperProps;

/**
 * Component used to display STDOUT and STDERR data coming from a process happening in the backend.
 * @param `channelName` The channelName for this component which will be used to establish IPC communication channels.
 * Channel names are as follows:
 * - `${channelName}:childProcessSTDOUT` - To display STDOUT from a process occurring in IPCMain.
 * - `${channelName}:childProcessSTDERR` - To display STDERR from a process occurring in IPCMain.
 * - `${channelName}:childProcessHasSpawned` - To clear the component when a process has spawned.
 * - `${channelName}:childProcessHasClosed` - To display an ending message when a process has closed.
 * - `${channelName}:childProcessRequestsMediaDisplay` - To display the media contents of a local file (i.e. image).
 * @param `defaultHeight` The height of the component.
 * @param `scrollDownPerUpdate` Whether to force the display to scroll down for each line that comes through.
 */
export const IPCQuill = React.memo(
  ({ channelName, defaultHeight = 530, scrollDownPerUpdate = false, ...paperProps }: IPCQuillProps) => {
    const { api } = window;
    const [quill, setQuill] = useState<Quill>();

    /**
     * Handler for receiving text from the backend.
     * @param text The text to be added to the quill editor.
     * @param format Additional formatting to be applied to the text.
     */
    const handleIncomingText = (text: string, format?: QuillFormat) => {
      const currentText = quill.getText();

      // By default, quill will always force a newline to be present if there is no text.
      // Insert the text, then delete the last character.
      if (currentText === "\n") {
        quill.insertText(0, text, format);
        quill.deleteText(quill.getText().length - 1, 1);
        // Otherwise, just insert the text.
      } else {
        quill.insertText(quill.getLength(), text, format);
      }

      // Scroll down to the bottom of the editor if such behavior is desire-able.
      if (scrollDownPerUpdate) {
        quill.root.scrollTop = quill.root.scrollHeight;
      }
    };

    const handleDisplayMedia = (url: string) => {
      // If the url is missing the app's media protocol, insert it.
      if (!RegExp(`^${MEDIAPROTOCOL}`).test(url)) {
        url = `${MEDIAPROTOCOL}://${url}`;
      }
      console.log("Displaying media:", url);
      quill.insertEmbed(quill.getLength(), "image", url);
    };

    const handleStart = (pid: number, shouldClearText: boolean = true) => {
      console.log(`IPCQuill: ${channelName} has spawned as new childProcess. Clearing text...`);
      quill && shouldClearText && quill.setText("");
    };

    const handleProcessClosed = (pid: number, exitCode: number) => {
      const currentText = quill.getText();
      const endingBlurb =
        exitCode != null
          ? exitCode === 0
            ? ""
            : `with errors (Error code: ${exitCode}`
          : "forcefully due to termination by the user";
      const endingMessage = `Job has ended ${endingBlurb}`;
      currentText === "\n"
        ? quill.setText(endingMessage)
        : quill.insertText(quill.getLength(), endingMessage, { color: exitCode === 0 ? "green" : "red", bold: true });
      if (scrollDownPerUpdate) {
        quill.root.scrollTop = quill.root.scrollHeight;
      }
    };

    /**
     * useEffect for registering events related to text output coming from the backend
     */
    useEffect(() => {
      if (quill == null) return;

      api.on(`${channelName}:childProcessSTDOUT`, handleIncomingText);
      api.on(`${channelName}:childProcessSTDERR`, handleIncomingText);
      api.on(`${channelName}:childProcessRequestsMediaDisplay`, handleDisplayMedia);
      api.on(`${channelName}:childProcessHasSpawned`, handleStart);
      api.on(`${channelName}:childProcessHasClosed`, handleProcessClosed);

      return () => {
        api.removeAllListeners(`${channelName}:childProcessSTDOUT`);
        api.removeAllListeners(`${channelName}:childProcessSTDERR`);
        api.removeAllListeners(`${channelName}:childProcessHasSpawned`);
        api.removeAllListeners(`${channelName}:childProcessHasClosed`);
      };
    }, [quill, channelName, scrollDownPerUpdate]);

    /**
     * Upon mounting the component, this function will be called to create the quill instance.
     */
    const wrapperRef = useCallback((wrapper: HTMLDivElement) => {
      if (wrapper == null) return;
      // Reset the wrapper inner contents to prevent the quill editor from growing
      wrapper.innerHTML = "";

      // Create the quill editor container
      const editor = document.createElement("div");

      // Register the permitted fontsize arguments that this quill editor can respond to
      // At the current setup, it will respond to all values involving px, rem, em, etc. units
      const Size = Quill.import("attributors/style/size");
      Size.whitelist = QUILLFONTSIZES;
      Quill.register(Size, true);

      // Register the permitted fontfamily arguments that this quill editor can respond to.
      // At the current setup, it will accept the fonts below. If you want to add more, you can do so here,
      const Font = Quill.import("attributors/style/font");
      Font.whitelist = QUILLFONTFAMILIES;
      Quill.register(Font, true);

      // Handling of image urls will have to be a bit more complicated.
      // This allows us to also embed gifs and other image media types.
      const Image = Quill.import("formats/image");
      Image.sanitize = function (url: string) {
        // If the url starts with the media protocol, return the url; otherwise, proceed with the default sanitization
        // according to the quill codebase
        if (new RegExp(String.raw`^${MEDIAPROTOCOL}`).test(url)) return url;
        return defaultImageSanitize(url);
      };
      Quill.register(Image, true);

      // Add the quill editor to the wrapper div node and create the quill editor itself
      // which will be registered automatically to the created editor div.
      // Structure:
      // .IPCQuillContainer
      // |---> .ql-container
      //       |-----> .ql-editor
      wrapper.append(editor);
      const q = new Quill(editor, {
        modules: {
          toolbar: null,
        },
      });

      setQuill(q);
    }, []);

    return (
      <Paper
        elevation={2}
        sx={{ height: defaultHeight, overflowY: "auto", padding: 0.5, borderRadius: 2 }}
        {...paperProps}
        className="IPCQuillContainer"
        ref={wrapperRef}
      />
    );
  },
  FastIsEqual
);
