/**
 * Vite's configured base path — "/" for local dev and a root-served deploy,
 * "/nethack-universal/" for a GitHub Pages *project* page (served from a
 * subpath). Always ends with "/". Every runtime fetch/import of a /public
 * asset must be prefixed with this instead of a bare leading "/", or it
 * breaks under a subpath deploy.
 */
export const BASE_URL = import.meta.env.BASE_URL;
