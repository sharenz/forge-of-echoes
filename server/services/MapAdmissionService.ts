export class MapAdmissionService {
  private readonly claimedTicketIds = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  claim(ticketId: string, expiresAt: number): boolean {
    const currentTime = this.now();
    this.prune(currentTime);
    if (expiresAt <= currentTime || this.claimedTicketIds.has(ticketId)) return false;
    this.claimedTicketIds.set(ticketId, expiresAt);
    return true;
  }

  get size(): number {
    this.prune(this.now());
    return this.claimedTicketIds.size;
  }

  private prune(currentTime: number): void {
    for (const [ticketId, expiresAt] of this.claimedTicketIds) {
      if (expiresAt <= currentTime) this.claimedTicketIds.delete(ticketId);
    }
  }
}
