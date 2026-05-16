import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Tenant Workspace Mapping', () => {
  test('GET /api/workspaces returns tenant-scoped workspaces with active workspace', async ({ request }) => {
    const res = await request.get('/api/workspaces', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(typeof body.tenant_id).toBe('number')
    expect(typeof body.active_workspace_id).toBe('number')
    expect(Array.isArray(body.workspaces)).toBe(true)
    expect(body.workspaces.length).toBeGreaterThan(0)

    const active = body.workspaces.find((w: any) => w.id === body.active_workspace_id)
    expect(active).toBeDefined()
    expect(active.tenant_id).toBe(body.tenant_id)

    for (const workspace of body.workspaces) {
      expect(workspace.tenant_id).toBe(body.tenant_id)
    }
  })

  test('default general project still loads under workspace hierarchy', async ({ request }) => {
    const projectListRes = await request.get('/api/projects?includeArchived=1', { headers: API_KEY_HEADER })
    expect(projectListRes.status()).toBe(200)
    const projectListBody = await projectListRes.json()
    const general = projectListBody.projects.find((p: any) => p.slug === 'general')

    expect(general).toBeDefined()
    expect(typeof general.workspace_id).toBe('number')

    const getProjectRes = await request.get(`/api/projects/${general.id}`, { headers: API_KEY_HEADER })
    expect(getProjectRes.status()).toBe(200)
    const getProjectBody = await getProjectRes.json()
    expect(getProjectBody.project.slug).toBe('general')

    const workspacesRes = await request.get('/api/workspaces', { headers: API_KEY_HEADER })
    const workspacesBody = await workspacesRes.json()
    const parentWorkspace = workspacesBody.workspaces.find((w: any) => w.id === getProjectBody.project.workspace_id)
    expect(parentWorkspace).toBeDefined()
    expect(parentWorkspace.tenant_id).toBe(workspacesBody.tenant_id)
  })

  test('GET /api/projects includes belt gap metadata fields', async ({ request }) => {
    const res = await request.get('/api/projects', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(Array.isArray(body.projects)).toBe(true)
    expect(body.projects.length).toBeGreaterThan(0)

    for (const project of body.projects) {
      expect(project).toHaveProperty('has_gap')
      expect(project).toHaveProperty('has_overdue_gap')
      expect(project).toHaveProperty('belt_gap')
      expect(project).toHaveProperty('primary_belt_target_date')

      expect([0, 1]).toContain(project.has_gap)
      expect([0, 1]).toContain(project.has_overdue_gap)
      expect(typeof project.belt_gap).toBe('number')
      expect(project.belt_gap).toBeGreaterThanOrEqual(0)
      expect(project.primary_belt_target_date === null || typeof project.primary_belt_target_date === 'number').toBe(true)

      // Invariant: overdue gap always implies a gap exists.
      if (project.has_overdue_gap === 1) {
        expect(project.has_gap).toBe(1)
      }
    }
  })

  test('archive lifecycle hides entities unless includeArchived=true', async ({ request }) => {
    const suffix = Date.now()

    const regionCreate = await request.post('/api/regions', {
      headers: API_KEY_HEADER,
      data: { name: `Archive Region ${suffix}` },
    })
    expect(regionCreate.status()).toBe(201)
    const region = (await regionCreate.json()).region

    const clientCreate = await request.post('/api/clients', {
      headers: API_KEY_HEADER,
      data: { region_id: region.id, name: `Archive Account ${suffix}` },
    })
    expect(clientCreate.status()).toBe(201)
    const client = (await clientCreate.json()).client

    const projectCreate = await request.post('/api/projects', {
      headers: API_KEY_HEADER,
      data: { client_id: client.id, name: `Archive Project ${suffix}` },
    })
    expect(projectCreate.status()).toBe(201)
    const project = (await projectCreate.json()).project

    const projectArchive = await request.patch('/api/projects', {
      headers: API_KEY_HEADER,
      data: { id: project.id, archive: true, reason: 'Lifecycle test archive' },
    })
    expect(projectArchive.status()).toBe(200)

    const clientArchive = await request.patch('/api/clients', {
      headers: API_KEY_HEADER,
      data: { id: client.id, archive: true, reason: 'Lifecycle test archive' },
    })
    expect(clientArchive.status()).toBe(200)

    const regionArchive = await request.patch('/api/regions', {
      headers: API_KEY_HEADER,
      data: { id: region.id, archive: true, reason: 'Lifecycle test archive' },
    })
    expect(regionArchive.status()).toBe(200)

    const regionsDefault = await request.get('/api/regions', { headers: API_KEY_HEADER })
    const regionsDefaultBody = await regionsDefault.json()
    expect(regionsDefaultBody.regions.some((r: any) => r.id === region.id)).toBe(false)

    const clientsDefault = await request.get('/api/clients', { headers: API_KEY_HEADER })
    const clientsDefaultBody = await clientsDefault.json()
    expect(clientsDefaultBody.clients.some((c: any) => c.id === client.id)).toBe(false)

    const projectsDefault = await request.get('/api/projects', { headers: API_KEY_HEADER })
    const projectsDefaultBody = await projectsDefault.json()
    expect(projectsDefaultBody.projects.some((p: any) => p.id === project.id)).toBe(false)

    const regionsAll = await request.get('/api/regions?includeArchived=true', { headers: API_KEY_HEADER })
    const regionsAllBody = await regionsAll.json()
    const archivedRegion = regionsAllBody.regions.find((r: any) => r.id === region.id)
    expect(archivedRegion).toBeDefined()
    expect(typeof archivedRegion.archived_at).toBe('number')

    const clientsAll = await request.get('/api/clients?includeArchived=true', { headers: API_KEY_HEADER })
    const clientsAllBody = await clientsAll.json()
    const archivedClient = clientsAllBody.clients.find((c: any) => c.id === client.id)
    expect(archivedClient).toBeDefined()
    expect(typeof archivedClient.archived_at).toBe('number')

    const projectsAll = await request.get('/api/projects?includeArchived=true', { headers: API_KEY_HEADER })
    const projectsAllBody = await projectsAll.json()
    const archivedProject = projectsAllBody.projects.find((p: any) => p.id === project.id)
    expect(archivedProject).toBeDefined()
    expect(typeof archivedProject.archived_at).toBe('number')
  })

  test('archive requires reason across region/account/project endpoints', async ({ request }) => {
    const suffix = Date.now()

    const regionCreate = await request.post('/api/regions', {
      headers: API_KEY_HEADER,
      data: { name: `Reason Region ${suffix}` },
    })
    expect(regionCreate.status()).toBe(201)
    const region = (await regionCreate.json()).region

    const clientCreate = await request.post('/api/clients', {
      headers: API_KEY_HEADER,
      data: { region_id: region.id, name: `Reason Account ${suffix}` },
    })
    expect(clientCreate.status()).toBe(201)
    const client = (await clientCreate.json()).client

    const projectCreate = await request.post('/api/projects', {
      headers: API_KEY_HEADER,
      data: { client_id: client.id, name: `Reason Project ${suffix}` },
    })
    expect(projectCreate.status()).toBe(201)
    const project = (await projectCreate.json()).project

    const noReasonRegion = await request.patch('/api/regions', {
      headers: API_KEY_HEADER,
      data: { id: region.id, archive: true },
    })
    expect(noReasonRegion.status()).toBe(400)

    const noReasonClient = await request.patch('/api/clients', {
      headers: API_KEY_HEADER,
      data: { id: client.id, archive: true },
    })
    expect(noReasonClient.status()).toBe(400)

    const noReasonProject = await request.patch('/api/projects', {
      headers: API_KEY_HEADER,
      data: { id: project.id, archive: true },
    })
    expect(noReasonProject.status()).toBe(400)
  })
})

