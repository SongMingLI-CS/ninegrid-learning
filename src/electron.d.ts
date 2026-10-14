export {};

declare global {
  interface Window {
    nineGridDesktop?: {
      confirmClose?: () => Promise<boolean>;
      onRequestClose?: (callback: () => void) => () => void;
    };
  }
}
