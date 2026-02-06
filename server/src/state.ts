import { WebSocket } from "ws";

export const activeSockets = new Map<string, WebSocket>();
