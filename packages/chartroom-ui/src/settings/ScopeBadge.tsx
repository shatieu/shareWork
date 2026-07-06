import type { ReactElement } from 'react';

/** Basename helper shared by the settings views -- the full path always rides the title attr. */
export function fileName(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

/** Small scope chip (managed/local/project/user) -- color-coded per scope, brass family. */
export function ScopeBadge({ scope }: { scope: string }): ReactElement {
  return <span className={`scope-badge scope-badge--${scope}`}>{scope}</span>;
}

/** Source-file chip: shows the basename, carries the absolute path in the title attribute. */
export function SourceFile({ file }: { file: string }): ReactElement {
  return (
    <span className="settings-file" title={file}>
      {fileName(file)}
    </span>
  );
}
