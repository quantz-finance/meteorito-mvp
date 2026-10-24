// Helpers del backend simulado (scripts/e2e/mock-server.mjs).
import { expect, type APIRequestContext, type Page } from '@playwright/test';
export const MOCK = 'http://localhost:8084';
export const MOCK_PIN = '135790';
export async function reset(request: APIRequestContext, orders: any[], card = false) { await request.post(`${MOCK}/__mock/reset`, { data: { orders, card } }); }
export async function state(request: APIRequestContext): Promise<any> { return (await request.get(`${MOCK}/__mock/state`)).json(); }
export async function patch(request: APIRequestContext, slug: string, set: any) { await request.post(`${MOCK}/__mock/patch`, { data: { slug, set } }); }
export async function failNext(request: APIRequestContext, f: { path: string; step?: string; times?: number; status?: number; error?: string; code?: string; delayMs?: number }) {
  await request.post(`${MOCK}/__mock/fail`, { data: { times: 1, ...f } });
}
export const calls = async (request: APIRequestContext, path: string, step?: string) =>
  ((await state(request)).calls as any[]).filter((c) => c.path === path && (step == null || c.step === step));
export async function waitApp(page: Page) { await expect(page.locator('#root')).not.toBeEmpty(); }
