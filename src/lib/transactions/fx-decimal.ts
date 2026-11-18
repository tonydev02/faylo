const DECIMAL_PATTERN = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const EXPANDED_DECIMAL_PATTERN = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/;

type DecimalParts = { coefficient: bigint; scale: number };

function decimalParts(value: string): DecimalParts | null {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const magnitude = BigInt(`${whole}${fraction}`);
  return { coefficient: sign === "-" ? -magnitude : magnitude, scale: fraction.length };
}

export function isPositiveDecimal(value: string): boolean {
  const parts = decimalParts(value);
  return parts !== null && parts.coefficient > BigInt(0);
}

export function expandDecimalExponent(value: string): string | null {
  const match = EXPANDED_DECIMAL_PATTERN.exec(value);
  if (!match) return null;
  const [, sign, whole, fraction = "", exponentText = "0"] = match;
  const exponent = BigInt(exponentText);
  if (exponent < BigInt(-10000) || exponent > BigInt(10000)) return null;

  const digits = `${whole}${fraction}`;
  const decimalPosition = BigInt(whole.length) + exponent;
  let expanded: string;
  if (decimalPosition <= BigInt(0)) {
    expanded = `0.${"0".repeat(Number(-decimalPosition))}${digits}`;
  } else if (decimalPosition >= BigInt(digits.length)) {
    expanded = `${digits}${"0".repeat(Number(decimalPosition - BigInt(digits.length)))}`;
  } else {
    const position = Number(decimalPosition);
    expanded = `${digits.slice(0, position)}.${digits.slice(position)}`;
  }

  if (expanded.includes(".")) expanded = expanded.replace(/0+$/, "").replace(/\.$/, "");
  if (expanded.startsWith(".")) expanded = `0${expanded}`;
  if (expanded === "") expanded = "0";
  return sign === "-" && expanded !== "0" ? `-${expanded}` : expanded;
}

export function multiplyDecimalAndRoundToInteger(amount: string, rate: string): string {
  const amountParts = decimalParts(amount);
  const rateParts = decimalParts(rate);
  if (!amountParts || !rateParts) throw new RangeError("FX conversion requires exact decimal strings.");

  const product = amountParts.coefficient * rateParts.coefficient;
  const denominator = BigInt(10) ** BigInt(amountParts.scale + rateParts.scale);
  const magnitude = product < BigInt(0) ? -product : product;
  let rounded = magnitude / denominator;
  if ((magnitude % denominator) * BigInt(2) >= denominator) rounded += BigInt(1);
  if (rounded === BigInt(0)) return "0";
  return product < BigInt(0) ? `-${rounded}` : rounded.toString();
}
