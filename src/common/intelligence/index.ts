/**
 * The shared intelligence contract.
 *
 * Types and pure functions only. Nothing here imports a domain module, a NestJS
 * provider or TypeORM — that is asserted by `intelligence-contract.boundary.spec`
 * and it is what lets `social-integrations` and `leadflow-analytics` both depend
 * on this without depending on each other.
 */
export * from './intelligence-fact';
export * from './intelligence-fact-source';
export * from './intelligence-metric';
export * from './intelligence-ratio';
export * from './intelligence-scope';
export * from './intelligence-window';
