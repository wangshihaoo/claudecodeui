type ShellInitMessage = {
  type: 'init';
  projectPath: string;
  sessionId: string | null;
  hasSession: boolean;
  provider: string;
  cols: number;
  rows: number;
  initialCommand: string | null | undefined;
  isPlainShell: boolean;
  forceRestart?: boolean;
  bypassPermissions?: boolean;
};

type ShellResizeMessage = {
  type: 'resize';
  cols: number;
  rows: number;
};

type ShellInputMessage = {
  type: 'input';
  data: string;
};

type ShellOutgoingMessage = ShellInitMessage | ShellResizeMessage | ShellInputMessage;

type ShellIncomingMessage =
  | { type: 'output'; data: string }
  // Sent instead of starting a PTY when the project path or session id is
  // rejected, so this is the only signal that the terminal will never start.
  | { type: 'error'; message?: string }
  | { type: 'auth_url'; url?: string }
  | { type: string; [key: string]: unknown };

/** Minimal local terminal transport used by the browser-only shell fixture. */
export type ShellSocket = {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((error: unknown) => void) | null;
  send: (payload: string) => void;
  close: () => void;
};

const SHELL_SOCKET_CONNECTING = 0;
const SHELL_SOCKET_OPEN = 1;
const SHELL_SOCKET_CLOSED = 3;

/** Creates a deterministic terminal transport without contacting a shell server. */
export function createLocalShellSocket(): ShellSocket {
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const socket: ShellSocket = {
    readyState: SHELL_SOCKET_CONNECTING,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: () => undefined,
    close: () => undefined,
  };

  const schedule = (callback: () => void, delay = 0): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  };

  const emit = (frame: ShellIncomingMessage, delay = 0): void => {
    schedule(() => {
      if (socket.readyState !== SHELL_SOCKET_OPEN) return;
      socket.onmessage?.({ data: JSON.stringify(frame) });
    }, delay);
  };

  socket.send = (payload: string): void => {
    if (socket.readyState !== SHELL_SOCKET_OPEN) return;

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      socket.onerror?.(new Error('Invalid local shell payload'));
      return;
    }

    const type = typeof message.type === 'string' ? message.type : '';
    if (type === 'init') {
      const projectPath = typeof message.projectPath === 'string' && message.projectPath
        ? message.projectPath
        : '/workspace/cloudcli-demo';
      emit({ type: 'output', data: `CloudCLI local shell\r\n${projectPath}\r\n$ ` });

      const initialCommand = typeof message.initialCommand === 'string'
        ? message.initialCommand.trim()
        : '';
      if (initialCommand) {
        emit({
          type: 'output',
          data: `\r\n$ ${initialCommand}\r\nLocal demo command completed.\r\nProcess exited with code 0\r\n`,
        }, 20);
      }
      return;
    }

    if (type === 'input') {
      const input = typeof message.data === 'string' ? message.data : '';
      if (input === '\u0003') {
        emit({ type: 'output', data: '^C\r\n$ ' });
      } else if (input === '\r' || input === '\n') {
        emit({ type: 'output', data: '\r\n$ ' });
      } else if (input) {
        emit({ type: 'output', data: input });
      }
    }
  };

  socket.close = (): void => {
    if (socket.readyState === SHELL_SOCKET_CLOSED) return;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    socket.readyState = SHELL_SOCKET_CLOSED;
    socket.onclose?.();
  };

  schedule(() => {
    if (socket.readyState !== SHELL_SOCKET_CONNECTING) return;
    socket.readyState = SHELL_SOCKET_OPEN;
    socket.onopen?.();
  });

  return socket;
}

export function isShellSocketOpen(socket: ShellSocket | null): boolean {
  return socket?.readyState === SHELL_SOCKET_OPEN;
}

export function isShellSocketActive(socket: ShellSocket | null): boolean {
  return socket?.readyState === SHELL_SOCKET_CONNECTING || socket?.readyState === SHELL_SOCKET_OPEN;
}

export function parseShellMessage(payload: string): ShellIncomingMessage | null {
  try {
    return JSON.parse(payload) as ShellIncomingMessage;
  } catch {
    return null;
  }
}

export function sendSocketMessage(ws: ShellSocket | null, message: ShellOutgoingMessage): void {
  if (ws && isShellSocketOpen(ws)) {
    ws.send(JSON.stringify(message));
  }
}
