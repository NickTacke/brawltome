/** One page of a ranked list, with what the pager needs. */
export type RankedPage<Entry> = { entries: Entry[]; totalRows: number; pageSize: number }
