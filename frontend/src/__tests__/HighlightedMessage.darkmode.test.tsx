import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { HighlightedMessage } from '../components/conversation/HighlightedMessage';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(__dirname, '../index.css');
const css = readFileSync(cssPath, 'utf8');

function darkBlock(): string {
  const m = css.match(/\[data-theme=["']dark["']\][^{]*\{([^}]+)\}/);
  if (!m) throw new Error('Dark theme block not found in index.css');
  return m[1];
}

function getVar(block: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*:\\s*([^;]+);`);
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

describe('HighlightedMessage dark-mode contrast', () => {
  const block = darkBlock();

  it('dark theme --highlight-bg uses vivid blue against assistant bubble', () => {
    expect(getVar(block, '--highlight-bg')?.toLowerCase()).toBe('#2563eb');
  });

  it('dark theme --highlight-border is a light blue', () => {
    expect(getVar(block, '--highlight-border')?.toLowerCase()).toBe('#93c5fd');
  });

  it('dark theme --highlight-text is white for AAA contrast', () => {
    expect(getVar(block, '--highlight-text')?.toLowerCase()).toBe('#ffffff');
  });

  it('renders key-phrase span with strengthened inline styles', () => {
    const html = renderToStaticMarkup(
      <HighlightedMessage
        content="Please confirm the booking."
        keyPhrases={['confirm the booking']}
        onSpeak={() => {}}
      />
    );
    // Inline style attribute must reference highlight CSS vars and stronger styles
    expect(html).toContain('var(--highlight-bg');
    expect(html).toContain('var(--highlight-text');
    expect(html).toContain('var(--highlight-border');
    expect(html).toMatch(/font-weight:\s*600/);
    expect(html).toMatch(/padding:\s*2px\s+5px/);
  });

  it('grammar-only span also applies highlight-text color and strengthened styles', () => {
    const html = renderToStaticMarkup(
      <HighlightedMessage
        content="I have been waiting for the bus."
        grammarNotes={[
          {
            phrase: 'have been waiting',
            grammar_point: 'Present Perfect Continuous',
            explanation: 'Action started in the past, ongoing now.',
          } as any,
        ]}
        onSpeak={() => {}}
      />
    );
    expect(html).toContain('have been waiting');
    expect(html).toContain('var(--highlight-text');
    expect(html).toMatch(/font-weight:\s*600/);
    expect(html).toMatch(/padding:\s*2px\s+5px/);
  });
});
