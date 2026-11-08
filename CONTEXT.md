# Faylo Financial Tracking

Faylo records one person's financial activity and tracked balances from explicit opening snapshots. This context defines the financial terms used across the product.

## Language

**Account**:
A balance-tracked bank, cash, or investment holding with a currency and opening balance. A credit card is not an account.
_Avoid_: Credit-card account, payment method

**Opening balance**:
The known starting amount of an account at its opening date; it establishes when balance tracking begins.
_Avoid_: Current balance, initial transaction

**Financial transaction**:
An economic event classified as income, expense, transfer, card settlement, or balance adjustment.
_Avoid_: Account movement, ledger entry

**Account entry**:
A signed movement that changes one tracked account's balance and is associated with a financial transaction.
_Avoid_: Transaction, expense

**Payment method**:
The means used to pay or receive money, such as cash, debit card, or credit card; it is not itself a tracked balance.
_Avoid_: Account

**Credit-card expense**:
An expense recognized when purchased using a credit card, without a tracked-account movement or card-liability balance.
_Avoid_: Credit-card account movement

**Card settlement**:
A later payment of a credit-card bill that reduces a bank or cash account but does not recognize another expense.
_Avoid_: Expense, transfer to a card account

**Transfer**:
A movement between two tracked accounts, represented by one debit and one credit; it is neither income nor expense.
_Avoid_: Income, expense

**Balance adjustment**:
An explicit, reasoned correction to a tracked account's balance that remains identifiable in financial history.
_Avoid_: Silent balance edit, reconciliation overwrite

**Unassigned income or expense**:
An income or expense event without a payment method or tracked-account movement; it remains reportable and requires reconciliation.
_Avoid_: Cash transaction, credit-card expense

**Voided transaction**:
A previously posted transaction marked invalid for current balance and report calculations while its original details remain available for audit.
_Avoid_: Deleted transaction, reversal entry
