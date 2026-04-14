import type {
  CoopChatMessage,
  CoopParticipant,
  CoopRole,
  CoopSessionVehicle,
  CoopSharedPlan,
  CoopStatePayload,
  MissionWaypoint,
} from '../../shared/types.js';

interface CoopSessionState<TConnection> {
  hostUserId?: string;
  hostUsername?: string;
  participants: Map<string, CoopParticipant>;
  sockets: Set<TConnection>;
  messages: CoopChatMessage[];
  sharedPlan: CoopSharedPlan | null;
  version: number;
}

interface CoopConnectionMeta {
  sessionId: string;
  vehicleId?: string;
  userId: string;
  username: string;
  role: CoopRole;
}

interface JoinParams {
  sessionId: string;
  vehicleId?: string;
  userId: string;
  username: string;
  role?: CoopRole;
}

interface ChatParams {
  sessionId: string;
  vehicleId?: string;
  userId: string;
  username: string;
  text: string;
}

interface ShareRouteParams {
  sessionId: string;
  vehicleId?: string;
  userId: string;
  username: string;
  waypoints: MissionWaypoint[];
  route?: { type: 'LineString'; coordinates: [number, number][] } | null;
  distanceMeters?: number;
  etaSeconds?: number;
}

interface CoopSessionServiceOptions {
  getInvitePath: (sessionId: string, hostVehicleId?: string) => string;
  getVehicleSnapshot: (vehicleId: string) => CoopSessionVehicle | undefined;
  resolveHost: (participant: CoopParticipant) => boolean;
  createId: (prefix: string) => string;
  now: () => number;
  loadMessages: (sessionId: string) => CoopChatMessage[];
  saveMessage: (message: CoopChatMessage) => void;
  clearMessages: (sessionId: string) => void;
}

export interface CoopBroadcast<TConnection> {
  sessionId: string;
  payload: CoopStatePayload;
  sockets: TConnection[];
}

export class InMemoryCoopSessionService<TConnection> {
  private readonly sessionById = new Map<string, CoopSessionState<TConnection>>();
  private readonly metaByConnection = new Map<TConnection, CoopConnectionMeta>();

  constructor(private readonly options: CoopSessionServiceOptions) {}

  getMeta(connection: TConnection) {
    return this.metaByConnection.get(connection);
  }

  join(connection: TConnection, params: JoinParams): CoopBroadcast<TConnection>[] {
    const previous = this.metaByConnection.get(connection);
    const broadcasts: CoopBroadcast<TConnection>[] = [];
    if (previous && (previous.sessionId !== params.sessionId || previous.userId !== params.userId)) {
      const leaveBroadcast = this.leave(connection);
      if (leaveBroadcast) broadcasts.push(leaveBroadcast);
    }
    const session = this.getOrCreateSession(params.sessionId);
    session.sockets.add(connection);
    const now = this.options.now();
    const role: CoopRole =
      params.role === 'spectator' ? 'spectator' : params.role === 'host' ? 'host' : 'driver';
    session.participants.set(params.userId, {
      userId: params.userId,
      username: params.username,
      vehicleId: params.vehicleId,
      role,
      joinedAt: session.participants.get(params.userId)?.joinedAt || now,
      lastSeenAt: now,
      isHost: false,
      isOnline: true,
      isActive: true,
      isSpeaking: false,
    });
    this.metaByConnection.set(connection, {
      sessionId: params.sessionId,
      vehicleId: params.vehicleId,
      userId: params.userId,
      username: params.username,
      role,
    });
    return [...broadcasts, this.buildBroadcast(params.sessionId)];
  }

  leave(connection: TConnection): CoopBroadcast<TConnection> | null {
    const meta = this.metaByConnection.get(connection);
    if (!meta) return null;
    this.metaByConnection.delete(connection);
    const session = this.sessionById.get(meta.sessionId);
    if (!session) return null;
    session.sockets.delete(connection);
    session.participants.delete(meta.userId);
    if (!session.sockets.size && !session.participants.size) {
      this.sessionById.delete(meta.sessionId);
      return null;
    }
    return this.buildBroadcast(meta.sessionId);
  }

  pushChat(params: ChatParams): { message: CoopChatMessage | null; broadcast: CoopBroadcast<TConnection> } | null {
    const session = this.getOrCreateSession(params.sessionId);
    const trimmed = params.text.trim();
    if (!trimmed) return null;
    const now = this.options.now();
    const message: CoopChatMessage = {
      id: this.options.createId('coop-msg'),
      sessionId: params.sessionId,
      vehicleId: params.vehicleId,
      authorId: params.userId,
      author: params.username,
      text: trimmed,
      ts: now,
    };
    this.options.saveMessage(message);
    session.messages = [...session.messages, message].slice(-50);
    const existing = session.participants.get(params.userId);
    session.participants.set(params.userId, {
      ...(existing || {
        userId: params.userId,
        username: params.username,
        vehicleId: params.vehicleId,
        role: params.vehicleId ? 'driver' : 'spectator',
        joinedAt: now,
        isHost: false,
      }),
      username: params.username,
      vehicleId: params.vehicleId || existing?.vehicleId,
      lastSeenAt: now,
      isOnline: true,
      isActive: true,
      isSpeaking: true,
    });
    return {
      message,
      broadcast: this.buildBroadcast(params.sessionId),
    };
  }

  setPlan(params: ShareRouteParams, actorUserId: string) {
    const session = this.getOrCreateSession(params.sessionId);
    if (session.hostUserId && session.hostUserId !== actorUserId) {
      return this.buildBroadcast(params.sessionId);
    }
    session.version += 1;
    session.sharedPlan = {
      sessionId: params.sessionId,
      vehicleId: params.vehicleId,
      updatedByUserId: params.userId,
      updatedByUsername: params.username,
      waypoints: params.waypoints,
      route: params.route,
      distanceMeters: params.distanceMeters,
      etaSeconds: params.etaSeconds,
      version: session.version,
      updatedAt: this.options.now(),
    };
    const participant = session.participants.get(params.userId);
    if (participant) {
      session.participants.set(params.userId, {
        ...participant,
        lastSeenAt: this.options.now(),
        isActive: true,
      });
    }
    return this.buildBroadcast(params.sessionId);
  }

  clearPlan(sessionId: string, actorUserId: string) {
    const session = this.getOrCreateSession(sessionId);
    if (session.hostUserId && session.hostUserId !== actorUserId) {
      return this.buildBroadcast(sessionId);
    }
    session.version += 1;
    session.sharedPlan = null;
    return this.buildBroadcast(sessionId);
  }

  clearChat(sessionId: string, actorUserId: string) {
    const session = this.getOrCreateSession(sessionId);
    if (session.hostUserId && session.hostUserId !== actorUserId) {
      return this.buildBroadcast(sessionId);
    }
    session.messages = [];
    this.options.clearMessages(sessionId);
    return this.buildBroadcast(sessionId);
  }

  buildBroadcastsForVehicle(vehicleId: string) {
    const broadcasts: CoopBroadcast<TConnection>[] = [];
    this.sessionById.forEach((session, sessionId) => {
      const hasVehicle = [...session.participants.values()].some((entry) => entry.vehicleId === vehicleId);
      if (hasVehicle) {
        broadcasts.push(this.buildBroadcast(sessionId));
      }
    });
    return broadcasts;
  }

  private getOrCreateSession(sessionId: string) {
    const existing = this.sessionById.get(sessionId);
    if (existing) return existing;
    const created: CoopSessionState<TConnection> = {
      participants: new Map(),
      sockets: new Set(),
      messages: this.options.loadMessages(sessionId),
      sharedPlan: null,
      version: 0,
    };
    this.sessionById.set(sessionId, created);
    return created;
  }

  private syncHost(sessionId: string) {
    const session = this.sessionById.get(sessionId);
    if (!session) return;
    let host = [...session.participants.values()].find((entry) => this.options.resolveHost(entry));
    if (!host) {
      host = [...session.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    }
    session.hostUserId = host?.userId;
    session.hostUsername = host?.username;
    session.participants.forEach((participant, userId) => {
      const isHost = userId === session.hostUserId;
      session.participants.set(userId, {
        ...participant,
        role: isHost ? 'host' : participant.role === 'host' ? 'driver' : participant.role,
        isHost,
        isOnline: [...session.sockets].some((socket) => this.metaByConnection.get(socket)?.userId === userId),
        isActive: this.options.now() - participant.lastSeenAt < 15_000,
        isSpeaking: this.options.now() - participant.lastSeenAt < 8_000 && participant.role !== 'spectator'
          ? participant.isSpeaking
          : false,
      });
    });
  }

  private buildVehicles(sessionId: string) {
    const session = this.sessionById.get(sessionId);
    if (!session) return [];
    const vehicles = new Map<string, CoopSessionVehicle>();
    session.participants.forEach((participant) => {
      if (!participant.vehicleId) return;
      const latest = this.options.getVehicleSnapshot(participant.vehicleId);
      vehicles.set(participant.vehicleId, {
        vehicleId: participant.vehicleId,
        userId: participant.userId,
        username: participant.username,
        lat: latest?.lat,
        lng: latest?.lng,
        heading: latest?.heading,
        speedMps: latest?.speedMps,
        lastUpdatedAt: latest?.lastUpdatedAt,
      });
    });
    return [...vehicles.values()];
  }

  private buildBroadcast(sessionId: string): CoopBroadcast<TConnection> {
    const session = this.getOrCreateSession(sessionId);
    this.syncHost(sessionId);
    const hostVehicleId = [...session.participants.values()].find(
      (entry) => entry.userId === session.hostUserId
    )?.vehicleId;
    return {
      sessionId,
      sockets: [...session.sockets],
      payload: {
        sessionId,
        invitePath: this.options.getInvitePath(sessionId, hostVehicleId),
        hostUserId: session.hostUserId,
        hostUsername: session.hostUsername,
        participants: [...session.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt),
        vehicles: this.buildVehicles(sessionId),
        messages: session.messages.slice(-50),
        sharedPlan: session.sharedPlan || null,
      },
    };
  }
}
