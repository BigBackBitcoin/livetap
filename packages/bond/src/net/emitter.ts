/**
 * A tiny typed event emitter.
 *
 * `@livetap/core` has one, and this package deliberately does not depend on core: Bond is a
 * networking layer, core is the broadcast domain, and a dependency edge from the former to the
 * latter would make it impossible to use Bond from the relay - which is a server with no notion of
 * Moments, destinations or production state.
 *
 * Twenty lines is cheaper than that coupling.
 */
export type Listener<T> = (payload: T) => void;

export class TypedEmitter<Events> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => {
      set?.delete(listener as Listener<never>);
    };
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch {
        /*
         * A listener that throws must not take the sender down with it. This is a networking layer
         * carrying a live broadcast: whatever a UI callback got wrong is strictly less important
         * than the stream continuing.
         */
      }
    }
  }
}
