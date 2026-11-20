import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ALL_USER_GUIDES,
  GUIDE_ROLES,
  getGuidesByRole,
  resolveContextualGuides,
  searchGuides,
} from '../data/userGuides/index';

const ROOT = resolve(import.meta.dirname, '..');

test('all 30 bilingual FR/AR guides have unique IDs and complete step content', () => {
  assert.equal(ALL_USER_GUIDES.length, 30, 'Expected 30 total user guides across 4 roles');
  const seenIds = new Set<string>();
  for (const guide of ALL_USER_GUIDES) {
    assert.ok(!seenIds.has(guide.id), `Duplicate guide id: ${guide.id}`);
    seenIds.add(guide.id);
    assert.ok(guide.titleFr.trim().length >= 5, `Missing titleFr on ${guide.id}`);
    assert.ok(guide.titleAr.trim().length >= 5, `Missing titleAr on ${guide.id}`);
    assert.ok(guide.summaryFr.trim().length >= 15, `Missing summaryFr on ${guide.id}`);
    assert.ok(guide.summaryAr.trim().length >= 15, `Missing summaryAr on ${guide.id}`);
    assert.ok(guide.contextKeys.length > 0, `Missing contextKeys on ${guide.id}`);
    assert.ok(guide.steps.length > 0, `Missing steps on ${guide.id}`);
    for (const [idx, step] of guide.steps.entries()) {
      assert.ok(step.titleFr.trim().length > 0, `Empty step ${idx} titleFr on ${guide.id}`);
      assert.ok(step.titleAr.trim().length > 0, `Empty step ${idx} titleAr on ${guide.id}`);
      assert.ok(step.bodyFr.trim().length > 0, `Empty step ${idx} bodyFr on ${guide.id}`);
      assert.ok(step.bodyAr.trim().length > 0, `Empty step ${idx} bodyAr on ${guide.id}`);
    }
  }
  assert.equal(getGuidesByRole('syndic').length, 15);
  assert.equal(getGuidesByRole('resident').length, 7);
  assert.equal(getGuidesByRole('provider').length, 3);
  assert.equal(getGuidesByRole('admin').length, 5);
});

test('every guide screenshot exists on disk under public/ and is a valid JPEG image', () => {
  const screenshots = ALL_USER_GUIDES.flatMap((g) =>
    g.steps
      .filter((s) => Boolean(s.screenshot))
      .map((s) => ({ guideId: g.id, src: s.screenshot!.src })),
  );
  assert.ok(screenshots.length >= 25, `Expected >= 25 screenshots, got ${screenshots.length}`);

  for (const item of screenshots) {
    assert.ok(
      item.src.startsWith('/guides/screenshots/'),
      `Screenshot path must start with /guides/screenshots/: ${item.src}`,
    );
    const absPath = join(ROOT, 'public', item.src.replace(/^\/+/, ''));
    assert.ok(
      existsSync(absPath),
      `Missing screenshot for ${item.guideId}: ${absPath}`,
    );
    const size = statSync(absPath).size;
    assert.ok(size > 5_000, `Screenshot too small (${size} bytes): ${item.src}`);
    const header = readFileSync(absPath).subarray(0, 3);
    assert.equal(header[0], 0xff, `Not a JPEG (byte 0): ${item.src}`);
    assert.equal(header[1], 0xd8, `Not a JPEG (byte 1): ${item.src}`);
    assert.equal(header[2], 0xff, `Not a JPEG (byte 2): ${item.src}`);
  }
});

test('every Syndic route, Resident tab, Provider screen, and Admin tab resolves a contextual guide', () => {
  const syndicRoutes = [
    'dashboard',
    'buildings',
    'apartments',
    'residents',
    'financials',
    'ag',
    'maintenance',
    'prestataires',
    'documents',
    'announcements',
    'chat',
    'marketplace',
    'analytics',
    'settings',
  ];
  for (const route of syndicRoutes) {
    const matched = resolveContextualGuides('syndic', route);
    assert.ok(matched.length > 0, `No contextual guide for syndic/${route}`);
  }

  for (const tab of ['overview', 'voting', 'maintenance', 'providers', 'chat', 'marketplace']) {
    const matched = resolveContextualGuides('resident', tab);
    assert.ok(matched.length > 0, `No contextual guide for resident/${tab}`);
  }

  assert.ok(resolveContextualGuides('provider', 'interventions').length > 0);

  for (const tab of ['cabinets', 'reports', 'billing', 'commercial', 'audit']) {
    const matched = resolveContextualGuides('admin', tab);
    assert.ok(matched.length > 0, `No contextual guide for admin/${tab}`);
  }
});

test('bilingual search finds guides in both French and Arabic', () => {
  const cmiHits = searchGuides('CMI');
  assert.ok(cmiHits.some((g) => g.id === 'admin-gateways'));
  assert.ok(cmiHits.some((g) => g.id === 'syndic-settings-billing'));

  const arHits = searchGuides('توصيل', 'resident');
  assert.ok(arHits.some((g) => g.id === 'resident-charges'));
});

test('synced Markdown manuals exist for master index and all 4 roles', () => {
  assert.ok(existsSync(join(ROOT, 'docs', 'guides', 'README.md')));
  for (const role of GUIDE_ROLES) {
    const filePath = join(ROOT, 'docs', 'guides', `${role.id}.md`);
    assert.ok(existsSync(filePath), `Missing generated manual: ${filePath}`);
    const content = readFileSync(filePath, 'utf8');
    assert.ok(content.includes('AUTO-GENERATED'), `Manual header missing in ${filePath}`);
  }
});
