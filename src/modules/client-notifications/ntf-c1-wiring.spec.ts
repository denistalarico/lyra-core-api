import { Module, type OnModuleInit } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClientNotificationSurfaceRegistry } from '../notifications/ports/client-notification-surface.port';

/**
 * NTF-C1 §48 — the registry handoff actually happens.
 *
 * WHY THIS SPEC EXISTS
 * --------------------
 * Because its absence is what caused the bug this sprint opened by proving.
 * AP3 wired the same seam as an injection token, which compiles, boots, logs
 * nothing and does nothing. The registry removes the silent mode of failure,
 * but only if something asserts that the handoff is performed — otherwise the
 * new design has the same observable behaviour as the broken one in the case
 * that matters.
 *
 * The real modules are not booted here: that needs two live database
 * connections and belongs to the PostgreSQL suites. What is proved is the
 * contract `ClientNotificationsModule.onModuleInit` implements, and the
 * resolution property that makes it work: a registry declared by the module
 * that declares the consumer resolves from a module that merely *imports* it,
 * which is exactly what a token bound in the importing module does not do.
 */
describe('NTF-C1 client notification surface registry', () => {
  const surfaceStub = {
    resolveAudience: async () => [],
    revalidate: async () => null,
  };

  it('an unfilled registry reports no implementation', () => {
    expect(new ClientNotificationSurfaceRegistry().get()).toBeNull();
  });

  /** The core module: declares the registry, like `NotificationsModule`. */
  @Module({
    providers: [ClientNotificationSurfaceRegistry],
    exports: [ClientNotificationSurfaceRegistry],
  })
  class CoreModule {}

  /** The join module: imports the core and fills it, like NTF-C1's. */
  @Module({ imports: [CoreModule] })
  class JoinModule implements OnModuleInit {
    constructor(private readonly registry: ClientNotificationSurfaceRegistry) {}
    onModuleInit(): void {
      this.registry.register(surfaceStub);
    }
  }

  it('is filled on init and is the same instance the core resolves', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JoinModule],
    }).compile();
    await moduleRef.init();

    // Resolved from the *core's* context, which is where the processor would
    // resolve it. A token bound by `JoinModule` would be absent here.
    const fromCore = moduleRef
      .select(CoreModule)
      .get(ClientNotificationSurfaceRegistry);

    expect(fromCore.get()).toBe(surfaceStub);
  });

  it('is empty before init, so the core degrades rather than misbehaving', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JoinModule],
    }).compile();

    const fromCore = moduleRef
      .select(CoreModule)
      .get(ClientNotificationSurfaceRegistry);

    expect(fromCore.get()).toBeNull();
  });
});
