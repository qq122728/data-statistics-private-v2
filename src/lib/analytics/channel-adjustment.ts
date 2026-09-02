export type ChannelAdjustmentState = "READY" | "INSUFFICIENT_PEERS" | "INSUFFICIENT_SAMPLE";

export type ChannelAdjustmentInput = {
  memberId: string;
  channels: Array<{
    groupId: string;
    normalizedName: string;
    effectiveFans: number;
    orders: number;
    peers: Array<{ memberId: string; effectiveFans: number; orders: number }>;
  }>;
  minMemberEffectiveFans: number;
  minPeerEffectiveFans: number;
};

export type ChannelAdjustmentResult = {
  actualOrders: number;
  expectedOrders: number | null;
  efficiency: number | null;
  state: ChannelAdjustmentState;
};

export function calculateChannelAdjustedEfficiency(input: ChannelAdjustmentInput): ChannelAdjustmentResult {
  const actualOrders = input.channels.reduce((sum, channel) => sum + channel.orders, 0);
  const memberEffectiveFans = input.channels.reduce((sum, channel) => sum + channel.effectiveFans, 0);
  if (memberEffectiveFans < input.minMemberEffectiveFans) {
    return { actualOrders, expectedOrders: null, efficiency: null, state: "INSUFFICIENT_SAMPLE" };
  }

  const channels = new Map<string, {
    effectiveFans: number;
    peers: Map<string, { effectiveFans: number; orders: number }>;
  }>();
  for (const channel of input.channels) {
    const key = `${channel.groupId}\0${channel.normalizedName}`;
    const current = channels.get(key) ?? { effectiveFans: 0, peers: new Map() };
    current.effectiveFans += channel.effectiveFans;
    for (const peer of channel.peers) {
      if (peer.memberId === input.memberId) continue;
      const peerTotals = current.peers.get(peer.memberId) ?? { effectiveFans: 0, orders: 0 };
      peerTotals.effectiveFans += peer.effectiveFans;
      peerTotals.orders += peer.orders;
      current.peers.set(peer.memberId, peerTotals);
    }
    channels.set(key, current);
  }

  let expectedOrders = 0;
  for (const channel of channels.values()) {
    if (channel.effectiveFans <= 0) continue;
    const peerTotals = [...channel.peers.values()].reduce(
      (sum, peer) => ({ effectiveFans: sum.effectiveFans + peer.effectiveFans, orders: sum.orders + peer.orders }),
      { effectiveFans: 0, orders: 0 },
    );
    if (peerTotals.effectiveFans < input.minPeerEffectiveFans) {
      return { actualOrders, expectedOrders: null, efficiency: null, state: "INSUFFICIENT_PEERS" };
    }
    expectedOrders += channel.effectiveFans * (peerTotals.orders / peerTotals.effectiveFans);
  }

  if (expectedOrders === 0) {
    return { actualOrders, expectedOrders, efficiency: null, state: "INSUFFICIENT_PEERS" };
  }
  return { actualOrders, expectedOrders, efficiency: actualOrders / expectedOrders, state: "READY" };
}
