export interface JoinViewerMessage {
  type: 'join';
  role: 'viewer';
  roomId: string;
  viewerId: string;
  token?: string;
}

export interface RequestMessage<TPayload = Record<string, unknown>> {
  type: string;
  requestId: string;
  roomId: string;
  viewerId: string;
  payload: TPayload;
}

export interface ResponseMessage<TPayload = Record<string, unknown>> {
  type: 'response';
  requestId: string;
  payload?: TPayload;
  error?: string;
}

export interface SubscribePayload {
  sdp: string;
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
}

export interface SubscribeResponsePayload {
  sdp: string;
}

export interface IcePullResponsePayload {
  candidates: Array<{
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
  }>;
}
