/**
 * One displayable image: a transcript image or an on-disk path. Apart from
 * `imageGallery` (which reads the desktop's transcripts): the iPhone app's
 * chat imports the pure image helpers that name it.
 */
export interface ImageRef {
  path: string;
  mediaType?: string;
  /** The prose the message writes around the path, shown in the lightbox. */
  caption?: string;
  /** Already in memory (an image pasted in the chat): shown, never fetched. */
  url?: string;
  /**
   * Said under the caption in place of the file name: an image with no file
   * (a chat visual's) gives its place in its walk, « 2 / 3 ». Empty: nothing.
   */
  label?: string;
}
