export interface FileDiff {
  oldPath: string;
  newPath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  addedLines: string[];
  deletedLines: string[];
  hunkContexts?: string[];
}

export interface CommitAnalyzerOptions {
  includeScope?: boolean;
  includeBody?: boolean;
  emojiStyle?: 'gitmoji' | 'simple';
}

export interface GeneratedCommitMessages {
  conventional: string;
  emoji: string;
  simple: string;
  detailed: string;
  type: string;
  scope?: string;
  subject: string;
  body?: string;
}

interface FileSummary {
  file: FileDiff;
  path: string;
  areaName: string;
  scopeName: string;
  category: 'code' | 'ui' | 'config' | 'docs' | 'test' | 'style' | 'build' | 'artifact';
  inferredType: 'feat' | 'fix' | 'refactor' | 'docs' | 'style' | 'test' | 'chore' | 'perf' | 'build';
  actionVerb: 'add' | 'fix' | 'update' | 'remove' | 'refactor' | 'improve';
  headline: string;
  detailBullet: string;
  weight: number;
}

const GITMOJI_MAP: Record<string, string> = {
  feat: '✨',
  fix: '🐛',
  refactor: '♻️',
  docs: '📝',
  style: '💄',
  test: '✅',
  chore: '🔧',
  perf: '⚡',
  build: '📦',
  ci: '👷',
  revert: '⏪'
};

const SIMPLE_EMOJI_MAP: Record<string, string> = {
  feat: '🚀',
  fix: '🛠️',
  refactor: '🧹',
  docs: '📖',
  style: '🎨',
  test: '🧪',
  chore: '⚙️',
  perf: '⚡',
  build: '📦',
  ci: '🔄',
  revert: '↩️'
};

const KNOWN_AREA_MAP: Record<string, { area: string; scope: string }> = {
  gitrepomanager: { area: 'repo manager', scope: 'repo-manager' },
  smartcommit: { area: 'smart commit', scope: 'smart-commit' },
  diffanalyzer: { area: 'smart commit', scope: 'smart-commit' },
  gitservice: { area: 'smart commit', scope: 'smart-commit' },
  htmldebugger: { area: 'html debugger', scope: 'html-debugger' },
  gitmanagement: { area: 'gitignore tools', scope: 'git-management' },
  scriptrunner: { area: 'script runner', scope: 'script-runner' },
  dashboard: { area: 'dashboard', scope: 'dashboard' },
  extension: { area: 'extension core', scope: 'core' }
};

const STOP_IDENTIFIERS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'const', 'let', 'var',
  'async', 'await', 'constructor', 'super', 'this', 'true', 'false', 'null', 'undefined',
  'string', 'number', 'boolean', 'any', 'void', 'promise', 'record', 'array', 'map', 'set',
  'get', 'post', 'put', 'delete', 'init', 'run', 'exec', 'execute', 'handle', 'activate',
  'deactivate', 'dispose', 'render', 'update', 'refresh', 'load', 'save', 'data', 'item',
  'items', 'result', 'results', 'value', 'values', 'options', 'config', 'context', 'state',
  'error', 'err', 'res', 'req', 'msg', 'message', 'lines', 'line', 'file', 'files', 'path'
]);

export class DiffAnalyzer {
  public static parseDiff(rawDiff: string): FileDiff[] {
    const fileDiffs: FileDiff[] = [];
    if (!rawDiff || !rawDiff.trim()) return fileDiffs;

    const diffBlocks = rawDiff.split(/^diff --git /m).filter(b => b.trim().length > 0);
    for (const block of diffBlocks) {
      const lines = block.split(/\r?\n/);
      let oldPath = '';
      let newPath = '';
      let status: 'added' | 'modified' | 'deleted' | 'renamed' = 'modified';
      const addedLines: string[] = [];
      const deletedLines: string[] = [];
      const hunkContexts: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('new file mode')) status = 'added';
        else if (line.startsWith('deleted file mode')) status = 'deleted';
        else if (line.startsWith('similarity index') || line.startsWith('rename from')) status = 'renamed';
        else if (line.startsWith('--- a/')) oldPath = line.substring(6);
        else if (line.startsWith('--- /dev/null')) { oldPath = ''; status = 'added'; }
        else if (line.startsWith('+++ b/')) newPath = line.substring(6);
        else if (line.startsWith('+++ /dev/null')) { newPath = ''; status = 'deleted'; }
        else if (line.startsWith('@@')) {
          const ctxMatch = line.match(/^@@[^@]+@@\s*(.+)$/);
          if (ctxMatch && ctxMatch[1].trim()) {
            hunkContexts.push(ctxMatch[1].trim());
          }
        }
        else if (line.startsWith('+') && !line.startsWith('+++')) addedLines.push(line.substring(1));
        else if (line.startsWith('-') && !line.startsWith('---')) deletedLines.push(line.substring(1));
      }

      if (!newPath && !oldPath) {
        const headerMatch = lines[0]?.match(/a\/(.+?)\s+b\/(.+)/);
        if (headerMatch) {
          oldPath = headerMatch[1];
          newPath = headerMatch[2];
        }
      }

      const filePath = (newPath || oldPath).replace(/\\/g, '/');
      if (filePath) {
        fileDiffs.push({
          oldPath: (oldPath || filePath).replace(/\\/g, '/'),
          newPath: (newPath || filePath).replace(/\\/g, '/'),
          status,
          addedLines,
          deletedLines,
          hunkContexts
        });
      }
    }
    return fileDiffs;
  }

  public static analyze(fileDiffs: FileDiff[], options: CommitAnalyzerOptions = {}): GeneratedCommitMessages {
    const includeScope = options.includeScope ?? true;
    const includeBody = options.includeBody ?? false;
    const emojiStyle = options.emojiStyle ?? 'gitmoji';

    if (fileDiffs.length === 0) {
      return {
        conventional: 'chore: update repository',
        emoji: '🔧 chore: update repository',
        simple: 'Update repository',
        detailed: 'chore: update repository',
        type: 'chore',
        subject: 'update repository'
      };
    }

    const allSummaries = fileDiffs.map(f => this.summarizeFile(f));
    const nonArtifactSummaries = allSummaries.filter(s => s.category !== 'artifact');
    const primarySummaries = nonArtifactSummaries.length > 0 ? nonArtifactSummaries : allSummaries;

    primarySummaries.sort((a, b) => b.weight - a.weight);

    const bestType = this.pickOverallType(primarySummaries);
    const scope = this.pickOverallScope(primarySummaries);
    const subject = this.composeOverallSubject(primarySummaries, bestType, scope);
    const body = this.composeBody(primarySummaries, allSummaries);

    const scopePrefix = scope && includeScope ? `(${scope})` : '';
    const conventionalHeader = `${bestType}${scopePrefix}: ${subject}`;
    const emojiMap = emojiStyle === 'simple' ? SIMPLE_EMOJI_MAP : GITMOJI_MAP;
    const emojiSymbol = emojiMap[bestType] || '✨';
    const emojiHeader = `${emojiSymbol} ${conventionalHeader}`;
    const simpleHeader = this.capitalize(subject);

    const withOptionalBody = (header: string) => (includeBody && body ? `${header}\n\n${body}` : header);
    const detailed = body ? `${conventionalHeader}\n\n${body}` : conventionalHeader;

    return {
      conventional: withOptionalBody(conventionalHeader),
      emoji: withOptionalBody(emojiHeader),
      simple: withOptionalBody(simpleHeader),
      detailed,
      type: bestType,
      scope: scope || undefined,
      subject,
      body
    };
  }

  private static summarizeFile(f: FileDiff): FileSummary {
    const path = f.newPath || f.oldPath;
    const lowerPath = path.toLowerCase();
    const fileName = path.split('/').pop() || path;
    const lowerName = fileName.toLowerCase();
    const baseName = fileName.replace(/\.[^/.]+$/, '');
    const cleanKey = baseName.toLowerCase().replace(/[^a-z0-9]/g, '');

    // 1. Identify generated/build artifacts so they don't drown out real source changes
    if (
      lowerPath.startsWith('build/') ||
      lowerPath.startsWith('dist/') ||
      lowerPath.startsWith('out/') ||
      lowerName.endsWith('.map') ||
      lowerName.endsWith('.vsix') ||
      lowerName.endsWith('.min.js') ||
      lowerName.endsWith('.min.css') ||
      lowerName === 'package-lock.json' ||
      lowerName === 'yarn.lock' ||
      lowerName === 'pnpm-lock.yaml'
    ) {
      return {
        file: f,
        path,
        areaName: 'build artifacts',
        scopeName: 'build',
        category: 'artifact',
        inferredType: 'build',
        actionVerb: 'update',
        headline: lowerName.endsWith('.vsix') ? 'repackage extension bundle' : 'update compiled build output',
        detailBullet: `rebuild compiled output and package artifacts`,
        weight: 1
      };
    }

    // 2. Special handling for package.json
    if (lowerName === 'package.json') {
      return this.summarizePackageJson(f);
    }

    // 3. Documentation files
    if (lowerName.endsWith('.md') || lowerName.startsWith('readme') || lowerName.startsWith('license') || lowerName.startsWith('changelog')) {
      const area = lowerName.startsWith('readme') ? 'README documentation' : this.humanizeWords(baseName);
      const verb = f.status === 'added' ? 'add' : 'update';
      return {
        file: f,
        path,
        areaName: 'docs',
        scopeName: 'docs',
        category: 'docs',
        inferredType: 'docs',
        actionVerb: verb,
        headline: `${verb} ${area}`,
        detailBullet: `docs: ${verb} ${area}`,
        weight: 15
      };
    }

    // 4. Build / configuration files
    if (
      lowerName === 'tsconfig.json' ||
      lowerName === '.gitignore' ||
      lowerName === '.vscodeignore' ||
      lowerName.endsWith('.ps1') ||
      lowerName.endsWith('.sh') ||
      lowerName.includes('webpack') ||
      lowerName.includes('eslint') ||
      lowerName.includes('prettier')
    ) {
      const label = lowerName === '.build.ps1' ? 'build script' : fileName;
      return {
        file: f,
        path,
        areaName: 'build',
        scopeName: 'build',
        category: 'build',
        inferredType: 'chore',
        actionVerb: f.status === 'added' ? 'add' : 'update',
        headline: `${f.status === 'added' ? 'add' : 'update'} ${label} configuration`,
        detailBullet: `build: ${f.status === 'added' ? 'add' : 'update'} ${label}`,
        weight: 10
      };
    }

    // 5. Determine readable area and scope
    const parts = path.split('/').filter(Boolean);
    const parentDir = parts.length >= 2 ? parts[parts.length - 2] : '';
    const parentKey = parentDir.toLowerCase().replace(/[^a-z0-9]/g, '');
    const parentKnown = parentKey ? KNOWN_AREA_MAP[parentKey] : undefined;
    const fileKnown = KNOWN_AREA_MAP[cleanKey];

    // If a file is inside a named feature folder (e.g., src/smartCommit/extension.ts), prefer the feature folder
    const effectiveKnown = (cleanKey === 'extension' && parentKnown) ? parentKnown : (fileKnown || parentKnown);

    let areaName = effectiveKnown ? effectiveKnown.area : this.humanizeWords(baseName);
    let scopeName = effectiveKnown ? effectiveKnown.scope : this.toKebabScope(baseName);

    if (!effectiveKnown && parentDir && !['src', 'lib', 'app', 'source', 'js', 'ts'].includes(parentDir.toLowerCase())) {
      scopeName = this.toKebabScope(parentDir);
    }

    if (f.status === 'deleted') {
      return {
        file: f,
        path,
        areaName,
        scopeName,
        category: 'code',
        inferredType: 'chore',
        actionVerb: 'remove',
        headline: `remove ${areaName}`,
        detailBullet: `${areaName}: remove ${fileName}`,
        weight: 30
      };
    }

    // 6. Semantic code analysis of added/deleted lines
    const addedText = f.addedLines.join('\n');
    const deletedText = f.deletedLines.join('\n');

    const addedSymbols = this.extractSymbols(f.addedLines);
    const deletedSymbols = new Set(this.extractSymbols(f.deletedLines));
    const newSymbols = addedSymbols.filter(s => !deletedSymbols.has(s));
    const modifiedSymbols = addedSymbols.filter(s => deletedSymbols.has(s));
    const hunkSymbols = this.extractSymbols(f.hunkContexts || []);

    const traits = this.detectSemanticTraits(addedText, deletedText, newSymbols, modifiedSymbols, hunkSymbols, areaName);

    let inferredType: FileSummary['inferredType'] = traits.type;
    let actionVerb: FileSummary['actionVerb'] = traits.verb;
    if (f.status === 'added') {
      inferredType = lowerPath.includes('test') || lowerPath.includes('spec') ? 'test' : 'feat';
      actionVerb = 'add';
    }

    const headline = traits.headline;
    const detailBullet = `${areaName}: ${traits.detail}`;
    const weight = 40 + Math.min(60, f.addedLines.length + f.deletedLines.length) + (newSymbols.length * 10);

    return {
      file: f,
      path,
      areaName,
      scopeName,
      category: lowerName.endsWith('.css') || lowerName.endsWith('.scss') ? 'style' : 'code',
      inferredType,
      actionVerb,
      headline,
      detailBullet,
      weight
    };
  }

  private static summarizePackageJson(f: FileDiff): FileSummary {
    const added = f.addedLines.join('\n');
    const deleted = f.deletedLines.join('\n');
    const combined = `${added}\n${deleted}`;

    const changes: string[] = [];
    let inferredType: FileSummary['inferredType'] = 'chore';
    let scopeName = 'config';

    if (/"type"\s*:\s*"webview"/.test(added) || /"views"\s*:|"viewsContainers"\s*:/.test(combined)) {
      changes.push('configure sidebar webview registration');
      inferredType = 'fix';
      scopeName = 'views';
    }
    if (/"activationEvents"\s*:|"onView:/.test(combined)) {
      changes.push('update view activation events');
    }
    if (/"commands"\s*:|"menus"\s*:|"submenus"\s*:|"keybindings"\s*:/.test(combined) && changes.length === 0) {
      changes.push('update command and menu contributions');
      inferredType = 'feat';
    }
    if (/"configuration"\s*:/.test(combined) && changes.length === 0) {
      changes.push('update extension settings schema');
    }

    const depLineChanged = f.addedLines.concat(f.deletedLines).some(l =>
      /^\s*"(@?[a-z0-9._/-]+)"\s*:\s*"[\^~>=<]*\d+\.\d+/i.test(l)
    );
    if (depLineChanged && changes.length === 0) {
      changes.push('update package dependencies');
      scopeName = 'deps';
    }

    const versionMatch = added.match(/"version"\s*:\s*"([^"]+)"/);
    if (versionMatch && changes.length === 0) {
      changes.push(`bump version to ${versionMatch[1]}`);
      scopeName = 'release';
    }

    const summaryText = changes.length > 0 ? changes.slice(0, 2).join(' and ') : 'update extension manifest';
    return {
      file: f,
      path: f.newPath || f.oldPath,
      areaName: 'manifest',
      scopeName,
      category: 'config',
      inferredType,
      actionVerb: 'update',
      headline: summaryText,
      detailBullet: `package.json: ${summaryText}`,
      weight: 20
    };
  }

  private static detectSemanticTraits(
    addedText: string,
    deletedText: string,
    newSymbols: string[],
    modifiedSymbols: string[],
    hunkSymbols: string[],
    areaName: string
  ): {
    type: FileSummary['inferredType'];
    verb: FileSummary['actionVerb'];
    headline: string;
    detail: string;
  } {
    const concepts: string[] = [];
    let isFix = false;
    let isFeat = newSymbols.length > 0;

    // Detect specific high-signal developer concepts from the diff, scoped by area
    if (areaName === 'smart commit') {
      if (/summarizeFile|detectSemanticTraits|composeOverallSubject/i.test(addedText)) {
        concepts.push('semantic diff analysis for commit message generation');
        isFeat = true;
      } else if (/autoStageIfNone|ls-files/i.test(addedText)) {
        concepts.push('unstaged and untracked diff collection');
        isFeat = true;
      }
    } else {
      if (/checkRemoteVisibility|RepoVisibility|VISIBILITY_LABEL|remoteVisibilityCache/i.test(addedText)) {
        concepts.push('public, private, and local repository visibility detection');
        isFeat = true;
      }
      if (/IGNORED_DIRECTORY_NAMES|isIgnoredDirectory/.test(addedText) && /startsWith\('\.'\)/.test(deletedText)) {
        concepts.push('dot-prefixed folder visibility in root directory scan');
        isFix = true;
      }
      if (/refreshTree/.test(addedText) && concepts.length === 0) {
        concepts.push('live tree refresh synchronization');
      }
    }

    // Command registrations
    const cmdMatches = Array.from(addedText.matchAll(/registerCommand\(\s*['"]([^'"]+)['"]/g)).map(m => m[1]);
    if (cmdMatches.length > 0 && concepts.length === 0) {
      const cmdNames = cmdMatches.map(c => this.humanizeWords(c.split('.').pop() || c)).slice(0, 2);
      concepts.push(`${cmdNames.join(' and ')} command${cmdNames.length > 1 ? 's' : ''}`);
      isFeat = true;
    }

    // If no special concept matched, derive natural concepts from new or modified symbols
    if (concepts.length === 0) {
      const meaningfulNew = newSymbols
        .map(s => this.humanizeSymbol(s))
        .filter(Boolean);
      const meaningfulMod = [...modifiedSymbols, ...hunkSymbols]
        .map(s => this.humanizeSymbol(s))
        .filter(Boolean);

      const uniqueNew = Array.from(new Set(meaningfulNew));
      const uniqueMod = Array.from(new Set(meaningfulMod));

      if (uniqueNew.length > 0) {
        concepts.push(uniqueNew.slice(0, 2).join(' and '));
        isFeat = true;
      } else if (uniqueMod.length > 0) {
        concepts.push(uniqueMod.slice(0, 2).join(' and '));
      }
    }

    // Check for fix signals if not clearly a new feature
    if (!isFeat && /\b(fix|bug|error|fallback|null|undefined|ignore|filter|depth|escape|guard|prevent|resolve)\b/i.test(addedText)) {
      isFix = true;
    }

    const type: FileSummary['inferredType'] = isFix && !isFeat ? 'fix' : isFeat ? 'feat' : 'refactor';
    const verb: FileSummary['actionVerb'] = isFix && !isFeat ? 'fix' : isFeat ? 'add' : 'update';

    if (concepts.length > 0) {
      const mainConcept = concepts[0];
      const secondConcept = concepts[1];
      const combinedConcepts = secondConcept ? `${mainConcept} and ${secondConcept}` : mainConcept;
      const needsAreaContext = !combinedConcepts.toLowerCase().includes(areaName.toLowerCase());
      const headline = needsAreaContext
        ? `${verb} ${combinedConcepts} in ${areaName}`
        : `${verb} ${combinedConcepts}`;
      return {
        type,
        verb,
        headline,
        detail: `${verb} ${combinedConcepts}`
      };
    }

    return {
      type,
      verb,
      headline: `${verb} ${areaName} logic`,
      detail: `${verb} ${areaName} implementation`
    };
  }

  private static extractSymbols(lines: string[]): string[] {
    const symbols: string[] = [];
    const patterns = [
      /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/,
      /\b(?:public|private|protected)\s+(?:static\s+)?(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
      /\b(?:export\s+)?(?:class|interface|type|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/,
      /\b(?:const|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/
    ];

    for (const line of lines) {
      for (const regex of patterns) {
        const m = line.match(regex);
        if (m && m[1] && !STOP_IDENTIFIERS.has(m[1].toLowerCase())) {
          symbols.push(m[1]);
          break;
        }
      }
    }
    return Array.from(new Set(symbols));
  }

  private static pickOverallType(summaries: FileSummary[]): FileSummary['inferredType'] {
    if (summaries.every(s => s.category === 'docs')) return 'docs';
    if (summaries.every(s => s.category === 'test')) return 'test';
    if (summaries.every(s => s.category === 'style')) return 'style';
    if (summaries.every(s => s.category === 'build' || s.category === 'config')) {
      return summaries.some(s => s.inferredType === 'fix' || s.inferredType === 'feat')
        ? summaries[0].inferredType
        : 'chore';
    }

    const codeSummaries = summaries.filter(s => s.category === 'code' || s.category === 'ui');
    const pool = codeSummaries.length > 0 ? codeSummaries : summaries;

    if (pool.some(s => s.inferredType === 'feat')) return 'feat';
    if (pool.some(s => s.inferredType === 'fix')) return 'fix';
    return pool[0]?.inferredType || 'refactor';
  }

  private static pickOverallScope(summaries: FileSummary[]): string {
    const codeSummaries = summaries.filter(s => s.category === 'code' || s.category === 'ui');
    const pool = codeSummaries.length > 0 ? codeSummaries : summaries;
    const scopes = Array.from(new Set(pool.map(s => s.scopeName).filter(Boolean)));
    if (scopes.length === 1) return scopes[0];
    if (scopes.length === 2) return `${scopes[0]}, ${scopes[1]}`;
    return scopes[0] || '';
  }

  private static composeOverallSubject(summaries: FileSummary[], overallType: string, _scope: string): string {
    const codeSummaries = summaries.filter(s => s.category === 'code' || s.category === 'ui');
    const pool = codeSummaries.length > 0 ? codeSummaries : summaries;

    if (pool.length === 1) {
      return this.trimSubject(pool[0].headline);
    }

    // Combine top 2 distinct headlines concisely
    const first = pool[0];
    const second = pool.find(s => s.areaName !== first.areaName && s.headline !== first.headline) || pool[1];

    if (second && second !== first) {
      const secondPart = second.detailBullet.split(': ')[1] || second.headline;
      const strippedSecond = secondPart.replace(/^(add|fix|update|remove|refactor|improve)\s+/i, '');
      const combined = `${first.headline} and ${strippedSecond}`;
      if (combined.length <= 76) {
        return combined;
      }
    }

    return this.trimSubject(first.headline);
  }

  private static composeBody(primarySummaries: FileSummary[], allSummaries: FileSummary[]): string {
    const bullets: string[] = [];
    const seen = new Set<string>();

    for (const s of primarySummaries) {
      if (!seen.has(s.detailBullet)) {
        seen.add(s.detailBullet);
        bullets.push(`- ${s.detailBullet}`);
      }
    }

    const hasArtifacts = allSummaries.some(s => s.category === 'artifact');
    if (hasArtifacts && primarySummaries.length > 0) {
      bullets.push('- build: recompile TypeScript output and repackage extension bundle');
    }

    return bullets.join('\n');
  }

  private static trimSubject(subject: string): string {
    const cleaned = subject.trim().replace(/\.$/, '');
    if (cleaned.length <= 78) return cleaned;
    return cleaned.substring(0, 75).replace(/\s+\S*$/, '') + '...';
  }

  private static humanizeSymbol(symbol: string): string {
    const stripped = symbol
      .replace(/^_+|_+$/g, '')
      .replace(/^(get|set|is|has|can|should|handle|on|do|build|render|create|update|fetch|check|parse|extract|compose|pick)(?=[A-Z])/g, '');
    const words = this.humanizeWords(stripped || symbol);
    if (!words || words.length < 3 || STOP_IDENTIFIERS.has(words)) return '';
    return words;
  }

  private static humanizeWords(raw: string): string {
    return raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/[-_.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private static toKebabScope(raw: string): string {
    return this.humanizeWords(raw).replace(/\s+/g, '-');
  }

  private static capitalize(str: string): string {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

