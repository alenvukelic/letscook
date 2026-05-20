declare module "pell" {
  export type PellAction =
    | string
    | {
        name: string;
        icon: string;
        title?: string;
        result: () => void;
      };

  export type PellEditor = {
    content: HTMLElement;
  };

  const pell: {
    init(options: {
      element: HTMLElement;
      onChange: (html: string) => void;
      defaultParagraphSeparator?: string;
      styleWithCSS?: boolean;
      actions?: PellAction[];
      classes?: Record<string, string>;
    }): PellEditor;
    exec(command: string, value?: string): void;
  };

  export default pell;
}
