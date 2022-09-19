import {
  AbstractMessageReader,
  DataCallback,
  Diagnostic,
  Disposable,
  Emitter,
  MessageReader,
  MessageWriter,
} from "vscode-languageserver";
import {
  BrowserMessageReader,
  BrowserMessageWriter,
} from "vscode-languageserver/browser";
import {
  LangiumInitialContent,
  LangiumMonarchContent,
  StateMachineInitialContent,
} from "./data";

export { BrowserMessageReader, BrowserMessageWriter };

declare type DedicatedWorkerGlobalScope = any;

export type PlaygroundMessageType = "validated" | "changing" | "error";

export interface PlaygroundMessageBase {
  type: PlaygroundMessageType;
}

export interface PlaygroundError extends PlaygroundMessageBase {
  type: "error";
  errors: Diagnostic[];
}

export interface PlaygroundOK extends PlaygroundMessageBase {
  type: "validated";
  grammar: string;
}

export interface PlaygroundChanging extends PlaygroundMessageBase {
  type: "changing";
}

export type PlaygroundMessage =
  | PlaygroundChanging
  | PlaygroundError
  | PlaygroundOK;

export interface Message {
  jsonrpc: string;
  result: any;
}

const MagicTypeString = "PlaygroundMagic";
interface Wrapper {
  type: typeof MagicTypeString;
  message: PlaygroundMessage;
}

export interface MessageWrapper<T> {
  wrap(message: T): Message;
  unwrap(message: Message): T | null;
}

export type MessageCallback<T> = (data: T) => void;

export class PlaygroundWrapper implements MessageWrapper<PlaygroundMessage> {
  wrap(message: PlaygroundMessage): Message {
    const wrapped = {
      type: MagicTypeString,
      message,
    };
    return { jsonrpc: "2.0", result: wrapped };
  }
  unwrap(message: Message): PlaygroundMessage | null {
    if(typeof message === 'object' && 'result' in message) {
        const parsed = message.result;
        if (
          parsed &&
          typeof parsed === "object" &&
          "type" in parsed &&
          parsed["type"] === MagicTypeString &&
          "message" in parsed
        ) {
          return parsed["message"] as PlaygroundMessage;
        }
    }
    return null;
  }
}

export class ByPassingMessageReader<T>
  extends AbstractMessageReader
  implements MessageReader
{
  private _onData: Emitter<Message>;
  private _onByPass: Emitter<T>;
  private _messageListener: (event: MessageEvent) => void;

  public constructor(
    port: MessagePort | Worker | DedicatedWorkerGlobalScope,
    wrapper: MessageWrapper<T>
  ) {
    super();
    this._onData = new Emitter<Message>();
    this._onByPass = new Emitter<T>();
    this._messageListener = (event: MessageEvent) => {
      const unwrapped = wrapper.unwrap(event.data);
      if (unwrapped) {
        return this._onByPass.fire(unwrapped);
      }
      this._onData.fire(event.data);
    };
    port.addEventListener("error", (event) => this.fireError(event));
    port.onmessage = this._messageListener;
  }

  public listen(callback: DataCallback): Disposable {
    return this._onData.event(x => callback(x as any));
  }

  public listenByPass(callback: MessageCallback<T>): Disposable {
    return this._onByPass.event(callback);
  }
}

export class ByPassingMessageWriter<T> extends BrowserMessageWriter {
  public constructor(
    port: MessagePort | Worker | DedicatedWorkerGlobalScope,
    private wrapper: MessageWrapper<T>
  ) {
    super(port);
  }

  public byPassWrite(message: T) {
    return this.write(this.wrapper.wrap(message));
  }
}

export interface MonacoConnection {
  reader: MessageReader;
  writer: MessageWriter;
}

export interface MonacoConfig {
  setMainCode(conent: string): void;
  setMainLanguageId(name: string): void;
  setMonarchTokensProvider(monarch: any): void;
  theme: string;
  useLanguageClient: boolean;
  useWebSocket: boolean;
}

export interface MonacoClient {
  getEditorConfig(): MonacoConfig;
  setWorker(worker: Worker, connection: MonacoConnection): void;
  startEditor(domElement: HTMLElement): void;
  updateLayout(): void;
}

export function setupEditor(
  domElement: HTMLElement,
  name: string,
  syntax: any,
  content: string,
  relativeWorkerURL: string,
  monacoFactory: () => MonacoClient,
  readerFactory: (worker: Worker) => ByPassingMessageReader<PlaygroundMessage>,
  writerFactory: (worker: Worker) => ByPassingMessageWriter<PlaygroundMessage>
) {
  domElement.childNodes.forEach((c) => domElement.removeChild(c));

  const client = monacoFactory();

  const editorConfig = client.getEditorConfig();
  editorConfig.setMainLanguageId(name);
  editorConfig.setMonarchTokensProvider(syntax);

  editorConfig.setMainCode(content);
  editorConfig.theme = "vs-dark";

  editorConfig.useLanguageClient = true;
  editorConfig.useWebSocket = false;

  const workerURL = new URL(relativeWorkerURL, import.meta.url);

  const worker = new Worker(workerURL.href, {
    type: "classic",
    name: "LS",
  });
  const result = {
    out: readerFactory(worker),
    in: writerFactory(worker),
  };
  client.setWorker(worker, {
    reader: result.out,
    writer: result.in
  });

  client.startEditor(domElement);
  window.addEventListener("resize", () => client.updateLayout());

  return result;
}

export function setupPlayground(
  monacoFactory: (name: string) => MonacoClient,
  leftEditor: HTMLElement,
  rightEditor: HTMLElement
) {
  const messageWrapper = new PlaygroundWrapper();

  const langium = setupEditor(
    leftEditor,
    "langium",
    LangiumMonarchContent,
    LangiumInitialContent,
    "../../libs/worker/langiumServerWorker.js",
    () => monacoFactory("langium"),
    (worker) => new ByPassingMessageReader(worker, messageWrapper),
    (worker) => new ByPassingMessageWriter(worker, messageWrapper)
  );

  langium.out.listenByPass(message => {
      const userDefined = setupEditor(
        rightEditor,
        "user",
        null,
        StateMachineInitialContent,
        "../../libs/worker/userServerWorker.js",
        () => monacoFactory("user"),
        (worker) => new ByPassingMessageReader(worker, messageWrapper),
        (worker) => new ByPassingMessageWriter(worker, messageWrapper)
      );
      userDefined.in.byPassWrite(message);
  });


}
