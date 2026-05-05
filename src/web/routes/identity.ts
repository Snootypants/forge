import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFileSync } from '../../utils/atomic-write.ts';

const FILES = ['IDENTITY.md', 'SOUL.md', 'USER.md'] as const;

export function identityRoutes(identityDir: string, onChange?: () => void): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const files = FILES.map(name => {
      const fp = path.join(identityDir, name);
      const content = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : '';
      return { name, content };
    });
    res.json({ files });
  });

  router.put('/:filename', (req, res) => {
    const { filename } = req.params;
    if (!FILES.includes(filename as typeof FILES[number])) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }
    const { content } = req.body;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content required' });
      return;
    }
    const fp = path.join(identityDir, filename);
    atomicWriteFileSync(fp, content, { encoding: 'utf-8', mode: 0o600 });
    onChange?.();
    res.json({ ok: true });
  });

  return router;
}
