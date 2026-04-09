import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSfuSignaling } from '@/app/hooks/useSfuSignaling';
import type { SubscribePayload } from '@shared/sfu';

interface UseWebRtcSubscriberOptions {
  signalingUrl: string;
  roomId: string;
  viewerId: string;
  token?: string;
  iceServers?: RTCIceServer[];
}

interface SubscriberState {
  isConnecting: boolean;
  isConnected: boolean;
  stream: MediaStream | null;
  error: string | null;
}

export function useWebRtcSubscriber(options: UseWebRtcSubscriberOptions) {
  const { signalingUrl, roomId, viewerId, token, iceServers } = options;
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const [state, setState] = useState<SubscriberState>({
    isConnecting: false,
    isConnected: false,
    stream: null,
    error: null,
  });
  const signaling = useSfuSignaling({
    url: signalingUrl,
    roomId,
    viewerId,
    token,
  });

  const disconnect = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.ontrack = null;
      peerRef.current.oniceconnectionstatechange = null;
      peerRef.current.close();
      peerRef.current = null;
    }
    setState((prev) => ({
      ...prev,
      isConnecting: false,
      isConnected: false,
      stream: null,
    }));
  }, []);

  const connect = useCallback(async () => {
    setState((prev) => ({ ...prev, isConnecting: true, error: null }));
    try {
      const pc = new RTCPeerConnection({
        iceServers: iceServers || [{ urls: ['stun:stun.l.google.com:19302'] }],
      });
      peerRef.current = pc;

      const remote = new MediaStream();
      pc.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach((track) => remote.addTrack(track));
        setState((prev) => ({
          ...prev,
          stream: remote,
        }));
      };

      pc.oniceconnectionstatechange = () => {
        const connected = ['connected', 'completed'].includes(pc.iceConnectionState);
        const failed = ['failed', 'closed', 'disconnected'].includes(pc.iceConnectionState);
        setState((prev) => ({
          ...prev,
          isConnected: connected,
          isConnecting: !connected && !failed,
          error: failed ? 'Peer connection lost' : prev.error,
        }));
      };

      pc.addTransceiver('video', { direction: 'recvonly' });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (!offer.sdp) {
        throw new Error('Offer SDP is missing');
      }

      const answerRaw = await signaling.request('subscribe', {
        sdp: offer.sdp,
        type: offer.type,
      } satisfies SubscribePayload);
      const answerSdp =
        answerRaw && typeof answerRaw.sdp === 'string'
          ? answerRaw.sdp
          : null;
      if (!answerSdp) {
        throw new Error('Invalid answer from signaling');
      }

      await pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });

      const candidatesRaw = await signaling.request('ice_pull');
      const candidates = Array.isArray(candidatesRaw?.candidates) ? candidatesRaw.candidates : [];

      for (const candidate of candidates) {
        if (candidate && typeof candidate === 'object') {
          await pc.addIceCandidate(candidate as RTCIceCandidateInit);
        }
      }

      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: null,
      }));
    } catch (error) {
      disconnect();
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: error instanceof Error ? error.message : 'WebRTC setup failed',
      }));
    }
  }, [disconnect, iceServers, signaling]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return useMemo(
    () => ({
      ...state,
      signalingConnected: signaling.isConnected,
      signalingError: signaling.lastError,
      connect,
      disconnect,
    }),
    [connect, disconnect, signaling.isConnected, signaling.lastError, state]
  );
}
