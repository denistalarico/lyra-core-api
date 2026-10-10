import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { TenantContextAuthority } from '../../common/context/tenant-context-authority.service';
import { FilesService } from '../../common/files/files.service';
import {
  getAgencyTypeOrmConfig,
  getTypeOrmConfig,
} from '../../config/typeorm.config';
import { AddKnowledgeAuthorDisplay1799100000000 } from '../../database/migrations/1799100000000-add-knowledge-author-display';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { KnowledgeModule } from './knowledge.module';

jest.mock('otplib', () => ({
  verify: jest.fn(() => Promise.resolve({ valid: false })),
}));

const run = describePostgresIntegration();

const SECRET = 'sec-a1-knowledge-authorship-secret-000001';

type Authored = {
  id: string;
  authorId: string;
  authorDisplayMode: string;
  authorDisplayValue: string | null;
};

/**
 * SEC-A1 — Knowledge authorship. The real author is always the authenticated
 * user; the browser only picks `authorDisplayMode`, and the backend composes
 * the shown label from the membership name and the Team job title. Before,
 * comments took the name from `x-user-name` and mural notes from the body.
 */
run('SEC-A1 Knowledge authorship (PostgreSQL)', () => {
  let app: INestApplication;
  let db: DataSource;
  let jwt: JwtService;

  const T = randomUUID();
  const W = randomUUID();
  const AUTHOR = randomUUID();
  const COEDITOR = randomUUID(); // same tenant, no Team job title
  const AUTHOR_NAME = 'Ana Autora';
  const AUTHOR_TITLE = 'Diretora de Marketing';
  const NAME_AND_ROLE = `${AUTHOR_NAME} — ${AUTHOR_TITLE}`;
  const SLUG = `sec-a1-${randomUUID().slice(0, 8)}`;

  let author = '';
  let coeditor = '';

  const http = () =>
    request(app.getHttpServer() as Parameters<typeof request>[0]);
  const as = (token: string, extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${token}`,
    ...extra,
  });
  const body = <T>(response: { body: unknown }) => response.body as T;

  const sign = (userId: string) =>
    jwt.sign(
      {
        sub: userId,
        tenantId: T,
        workspaceId: W,
        role: 'owner',
        sessionId: randomUUID(),
        email: `${userId.slice(0, 8)}@sec-a1.example.com`,
      },
      { secret: SECRET, expiresIn: '15m' },
    );

  const setAuthorTitle = (jobTitle: string | null) =>
    db.query(
      `UPDATE team_members SET job_title = $3 WHERE tenant_id = $1 AND user_id = $2`,
      [T, AUTHOR, jobTitle],
    );

  const createArticle = (
    token: string,
    payload: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) =>
    http()
      .post('/agency/knowledge/articles')
      .set(as(token, headers))
      .send({
        title: 'Artigo SEC-A1',
        slug: `${SLUG}-${randomUUID().slice(0, 6)}`,
        ...payload,
      });

  const deleteFixtureTenant = async () => {
    const tables: Array<{ table_name: string }> = await db.query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
    );
    let pending = tables.map((row) => row.table_name);
    for (let pass = 0; pass < 8 && pending.length > 0; pass += 1) {
      const failed: string[] = [];
      for (const table of pending) {
        try {
          await db.query(`DELETE FROM "${table}" WHERE tenant_id = $1`, [T]);
        } catch {
          failed.push(table);
        }
      }
      pending = failed;
    }
  };

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = SECRET;

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        TypeOrmModule.forRoot(getTypeOrmConfig()),
        TypeOrmModule.forRoot(getAgencyTypeOrmConfig()),
        PassportModule,
        JwtModule.register({}),
        KnowledgeModule,
      ],
      providers: [JwtStrategy, TenantContextAuthority],
    })
      .overrideProvider(FilesService)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    db = moduleRef.get<DataSource>(getDataSourceToken('agency'));
    jwt = moduleRef.get(JwtService, { strict: false });

    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await new AddKnowledgeAuthorDisplay1799100000000().up(runner);
    } finally {
      await runner.release();
    }

    await deleteFixtureTenant();
    await db.query(
      `INSERT INTO workspace_users (tenant_id, workspace_id, user_id, name, email, role, status) VALUES
        ($1, $2, $3, $5, 'author@sec-a1.example.com', 'owner', 'active'),
        ($1, $2, $4, 'Carlos Coeditor', 'coeditor@sec-a1.example.com', 'owner', 'active')`,
      [T, W, AUTHOR, COEDITOR, AUTHOR_NAME],
    );
    await db.query(
      `INSERT INTO team_members (tenant_id, workspace_id, user_id, display_name, job_title, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [T, W, AUTHOR, AUTHOR_NAME, AUTHOR_TITLE],
    );

    author = sign(AUTHOR);
    coeditor = sign(COEDITOR);
  }, 60_000);

  afterAll(async () => {
    if (db?.isInitialized) await deleteFixtureTenant();
    await app?.close();
  });

  afterEach(() => setAuthorTitle(AUTHOR_TITLE));

  it('preview shows exactly what the backend would publish', async () => {
    const response = await http()
      .get('/agency/knowledge/authorship')
      .set(as(author));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      name: AUTHOR_NAME,
      jobTitle: AUTHOR_TITLE,
      options: { name_and_role: NAME_AND_ROLE, role_only: AUTHOR_TITLE },
    });
  });

  describe('name + job title', () => {
    it('article: real name and Team job title of the authenticated user', async () => {
      const response = await createArticle(author, {
        authorDisplayMode: 'name_and_role',
      });

      expect(response.status).toBe(201);
      expect(body<Authored>(response)).toMatchObject({
        authorId: AUTHOR,
        authorDisplayMode: 'name_and_role',
        authorDisplayValue: NAME_AND_ROLE,
      });
    });

    it('defaults to name + job title when no mode is sent', async () => {
      const response = await createArticle(author, {});

      expect(body<Authored>(response).authorDisplayValue).toBe(NAME_AND_ROLE);
    });

    it('without a Team job title, shows the name alone', async () => {
      const response = await createArticle(coeditor, {});

      expect(body<Authored>(response).authorDisplayValue).toBe(
        'Carlos Coeditor',
      );
    });
  });

  describe('job title only', () => {
    it('shows only the job title, and the audit still knows the author', async () => {
      const response = await createArticle(author, {
        authorDisplayMode: 'role_only',
      });
      const article = body<Authored>(response);

      expect(response.status).toBe(201);
      expect(article.authorDisplayValue).toBe(AUTHOR_TITLE);
      expect(article.authorDisplayValue).not.toContain(AUTHOR_NAME);

      const rows: Array<Record<string, string>> = await db.query(
        `SELECT author_id, author_display_mode, author_display_value
           FROM agency_knowledge_articles WHERE id = $1`,
        [article.id],
      );
      const [row] = rows;
      expect(row).toEqual({
        author_id: AUTHOR,
        author_display_mode: 'role_only',
        author_display_value: AUTHOR_TITLE,
      });
    });

    it('is refused (never falls back to the name) when there is no Team job title', async () => {
      const response = await createArticle(coeditor, {
        authorDisplayMode: 'role_only',
      });

      expect(response.status).toBe(400);
    });

    it('ignores an inactive Team record', async () => {
      await db.query(
        `UPDATE team_members SET status = 'inactive' WHERE tenant_id = $1 AND user_id = $2`,
        [T, AUTHOR],
      );
      try {
        const response = await createArticle(author, {
          authorDisplayMode: 'role_only',
        });
        expect(response.status).toBe(400);
      } finally {
        await db.query(
          `UPDATE team_members SET status = 'active' WHERE tenant_id = $1 AND user_id = $2`,
          [T, AUTHOR],
        );
      }
    });
  });

  describe('name impersonation via x-user-name', () => {
    it('comment: header ignored, identity stays A', async () => {
      const article = body<Authored>(await createArticle(author, {}));
      const response = await http()
        .post(`/agency/knowledge/articles/${article.id}/comments`)
        .set(as(author, { 'x-user-name': 'Usuário B' }))
        .send({ body: 'Comentário' });
      const comment = body<Authored & { authorName: string | null }>(response);

      expect(response.status).toBe(201);
      expect(comment.authorId).toBe(AUTHOR);
      expect(comment.authorDisplayValue).toBe(NAME_AND_ROLE);
      expect(comment.authorName).toBeNull();
      expect(JSON.stringify(response.body)).not.toContain('Usuário B');

      const listed = await http()
        .get(`/agency/knowledge/articles/${article.id}/comments`)
        .set(as(coeditor));
      expect(JSON.stringify(listed.body)).not.toContain('Usuário B');
    });

    it('article and note: header ignored', async () => {
      const article = await createArticle(
        author,
        {},
        { 'x-user-name': 'Usuário B' },
      );
      const note = await http()
        .post('/agency/knowledge/notes')
        .set(as(author, { 'x-user-name': 'Usuário B' }))
        .send({ title: 'Nota' });

      expect(body<Authored>(article).authorDisplayValue).toBe(NAME_AND_ROLE);
      expect(note.status).toBe(201);
      expect(body<Authored & { authorName: string }>(note)).toMatchObject({
        authorId: AUTHOR,
        authorDisplayValue: NAME_AND_ROLE,
        authorName: NAME_AND_ROLE,
      });
    });
  });

  describe('forged job title or author text', () => {
    it.each([
      ['article', { authorDisplayValue: 'Administrador' }],
      ['article', { authorName: 'Fulano' }],
      ['article', { authorRole: 'CEO' }],
      ['article', { authorDisplayMode: 'CEO' }],
    ])('%s with %j → 400, nothing created', async (_kind, forged) => {
      const response = await createArticle(author, forged);
      expect(response.status).toBe(400);
    });

    it('note with authorName "CEO" in the body → 400 (it used to be stored as-is)', async () => {
      const response = await http()
        .post('/agency/knowledge/notes')
        .set(as(author))
        .send({ title: 'Nota', authorName: 'CEO' });

      expect(response.status).toBe(400);
      const rows: unknown[] = await db.query(
        `SELECT 1 FROM agency_knowledge_quick_notes WHERE tenant_id = $1 AND author_name = 'CEO'`,
        [T],
      );
      expect(rows).toHaveLength(0);
    });

    it('comment with authorDisplayValue → 400', async () => {
      const article = body<Authored>(await createArticle(author, {}));
      const response = await http()
        .post(`/agency/knowledge/articles/${article.id}/comments`)
        .set(as(author))
        .send({ body: 'x', authorDisplayValue: 'CEO' });

      expect(response.status).toBe(400);
    });
  });

  describe('job title change and snapshot', () => {
    it('published content keeps the label shown at publication', async () => {
      const article = body<Authored>(
        await createArticle(author, {
          status: 'published',
          authorDisplayMode: 'name_and_role',
        }),
      );
      await setAuthorTitle('CMO');

      const edited = await http()
        .patch(`/agency/knowledge/articles/${article.id}`)
        .set(as(author))
        .send({ title: 'Título editado', authorDisplayMode: 'name_and_role' });

      expect(edited.status).toBe(200);
      expect(body<Authored>(edited).authorDisplayValue).toBe(NAME_AND_ROLE);

      const reread = await http()
        .get(`/agency/knowledge/articles/${article.id}`)
        .set(as(coeditor));
      expect(body<Authored>(reread).authorDisplayValue).toBe(NAME_AND_ROLE);
    });

    it('the author choosing another mode recomposes with the current job title', async () => {
      const article = body<Authored>(
        await createArticle(author, { status: 'published' }),
      );
      await setAuthorTitle('CMO');

      const response = await http()
        .patch(`/agency/knowledge/articles/${article.id}`)
        .set(as(author))
        .send({ authorDisplayMode: 'role_only' });

      expect(body<Authored>(response)).toMatchObject({
        authorDisplayMode: 'role_only',
        authorDisplayValue: 'CMO',
      });
    });

    it('a draft published later is stamped at publication', async () => {
      const draft = body<Authored>(await createArticle(author, {}));
      await setAuthorTitle('CMO');

      const response = await http()
        .patch(`/agency/knowledge/articles/${draft.id}`)
        .set(as(author))
        .send({ status: 'published' });

      expect(body<Authored>(response).authorDisplayValue).toBe(
        `${AUTHOR_NAME} — CMO`,
      );
    });
  });

  describe('edit history (headerJson.history) is server-owned', () => {
    type WithHistory = Authored & {
      headerJson: {
        keywords?: string[];
        history?: Array<{ savedAt: string; savedBy: string }>;
      };
    };
    const forged = {
      savedAt: '2020-01-01T00:00:00.000Z',
      savedBy: 'Usuário B',
    };

    it('savedBy = "Usuário B" from A → history records A’s real name', async () => {
      const article = body<Authored>(await createArticle(author, {}));

      const response = await http()
        .patch(`/agency/knowledge/articles/${article.id}`)
        .set(as(author, { 'x-user-name': 'Usuário B' }))
        .send({ headerJson: { keywords: ['seo'], history: [forged] } });
      const saved = body<WithHistory>(response);

      expect(response.status).toBe(200);
      expect(saved.headerJson.keywords).toEqual(['seo']);
      expect(saved.headerJson.history).toHaveLength(1);
      expect(saved.headerJson.history?.[0]?.savedBy).toBe(AUTHOR_NAME);
      expect(JSON.stringify(saved.headerJson)).not.toContain('Usuário B');

      const rows: Array<{ header_json: WithHistory['headerJson'] }> =
        await db.query(
          `SELECT header_json FROM agency_knowledge_articles WHERE id = $1`,
          [article.id],
        );
      expect(rows[0]?.header_json.history?.map((e) => e.savedBy)).toEqual([
        AUTHOR_NAME,
      ]);
    });

    it('cannot erase or rewrite earlier entries; each editor signs their own save', async () => {
      const article = body<Authored>(await createArticle(author, {}));
      const save = (token: string, history: unknown[]) =>
        http()
          .patch(`/agency/knowledge/articles/${article.id}`)
          .set(as(token))
          .send({ headerJson: { history } });

      await save(author, []);
      const second = await save(coeditor, [forged]);

      expect(
        body<WithHistory>(second).headerJson.history?.map((e) => e.savedBy),
      ).toEqual([AUTHOR_NAME, 'Carlos Coeditor']);
    });

    it('a new article ignores a history sent on creation', async () => {
      const response = await createArticle(author, {
        headerJson: { history: [forged] },
      });

      expect(body<WithHistory>(response).headerJson.history).toBeUndefined();
    });
  });

  describe('someone else editing', () => {
    it('cannot change how the author is credited → 403', async () => {
      const article = body<Authored>(await createArticle(author, {}));

      const response = await http()
        .patch(`/agency/knowledge/articles/${article.id}`)
        .set(as(coeditor))
        .send({ authorDisplayMode: 'role_only' });

      expect(response.status).toBe(403);
    });

    it('can edit content; authorship stays the author’s', async () => {
      const article = body<Authored>(
        await createArticle(author, { status: 'published' }),
      );

      const response = await http()
        .patch(`/agency/knowledge/articles/${article.id}`)
        .set(as(coeditor))
        .send({ title: 'Editado pelo coeditor', status: 'published' });

      expect(response.status).toBe(200);
      expect(body<Authored>(response)).toMatchObject({
        authorId: AUTHOR,
        authorDisplayValue: NAME_AND_ROLE,
      });
    });
  });
});
