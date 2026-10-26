/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `fixtures` builds an offline bundle that never calls the server. */
  readonly VITE_DATA_SOURCE?: string;
}
