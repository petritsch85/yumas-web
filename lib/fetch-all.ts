type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Read every row of a Supabase query.
 *
 * PostgREST caps a single response at 1000 rows and gives no indication that it
 * truncated, so a plain `.select()` on a large table silently returns a slice.
 * Pass a builder that applies `.range(from, to)` to your query.
 *
 * The query MUST have a deterministic order (add `.order('id')` if there is no
 * natural one) or pages can overlap and drop rows.
 */
export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await buildPage(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}
