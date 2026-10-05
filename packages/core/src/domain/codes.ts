import type { DB } from '@farmgo/db';

type Sequence = 'order_code_seq' | 'route_code_seq' | 'invoice_number_seq';

async function next(db: DB, seq: Sequence): Promise<bigint> {
  const rows = await db.$queryRawUnsafe<{ v: bigint }[]>(`SELECT nextval('${seq}') AS v`);
  return rows[0]!.v;
}

const yy = (d = new Date()) => String(d.getUTCFullYear()).slice(2);

/** FG-26-001234 */
export async function nextOrderCode(db: DB): Promise<string> {
  return `FG-${yy()}-${String(await next(db, 'order_code_seq')).padStart(6, '0')}`;
}

/** RT-26-0123 */
export async function nextRouteCode(db: DB): Promise<string> {
  return `RT-${yy()}-${String(await next(db, 'route_code_seq')).padStart(4, '0')}`;
}

/** INV-26-00012 */
export async function nextInvoiceNumber(db: DB): Promise<string> {
  return `INV-${yy()}-${String(await next(db, 'invoice_number_seq')).padStart(5, '0')}`;
}
