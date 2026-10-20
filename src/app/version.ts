import metadata from '../../package.json' with { type: 'json' };

/** Package metadata is the single version source for the application. */
export const applicationVersion = metadata.version;
