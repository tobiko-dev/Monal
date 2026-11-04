import { IdentityFailure, publicIdentity, sameIdentity } from "./identity-protocol.mjs";

// The repository and Python working copies stay wholly inside the worker.
export class IdentityService {
  constructor(repository, engine) { this.repository = repository; this.engine = engine; }

  async create(account) {
    return this.repository.provision(account, async () => {
      const change = await this.engine.create(account);
      const result = publicIdentity({ identity: change.identity, revision: 1 });
      return { ...change, result }; // Exposed only after the IDB transaction completes.
    });
  }

  async open(account) {
    return this.repository.read(account, async (previous) => {
      const identity = await this.engine.open(account, previous);
      if (!sameIdentity(identity, previous.identity)) throw new IdentityFailure("IDENTITY_CHANGED");
      return publicIdentity({ identity, revision: previous.revision });
    });
  }
}
