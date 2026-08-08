export type BillResult = {
  provider: string;
  amount: string;
  dueDate?: string;
  billPeriod?: string;
  status?: string;
  accountLabel: string;
  rawNotes?: string;
};
