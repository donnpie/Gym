#!/usr/bin/env python3
"""
Rep-max forecast table.

For each (actual_reps, actual_weight) data point, estimate the weight you
could lift at every rep count from 1 to 10, using the average of three
standard rep-max formulas (Epley, Brzycki, Lombardi). Then average across
rows to get a consensus estimate per rep level — both including and
excluding the actual data point.

Edit DATA below to match your "best at >= N reps" table for one
person/exercise. The diagonal cells (where target_reps == actual_reps)
naturally equal the actual weight.
"""

# === Your data — pasted from the Best lift lookup table. ===
DATA = [
    # (actual_reps, actual_weight_kg)
    (1,  82.5),
    (2,  82.5),
    (3,  82.5),
    (4,  75.5),
    (5,  75.0),
    (6,  70.0),
    (7,  67.5),
    (8,  67.5),
    (9,  67.5),
    (10, 65.0),
]

TARGET_REPS = list(range(1, 11))  # forecast columns: rep 1..10


# --- 1RM estimators (each takes weight + reps, returns estimated 1RM) ---
def epley(w, r):    return w * (1 + r / 30)
def brzycki(w, r):  return w * 36 / (37 - r)
def lombardi(w, r): return w * (r ** 0.10)


# --- Inverse: weight needed to hit N reps given an estimated 1RM ---
def epley_w(orm, n):    return orm / (1 + n / 30)
def brzycki_w(orm, n):  return orm * (37 - n) / 36
def lombardi_w(orm, n): return orm / (n ** 0.10)


def forecast(actual_weight, actual_reps, target_reps):
    """Average forecast across the three formulas."""
    estimates = [
        epley_w(epley(actual_weight, actual_reps), target_reps),
        brzycki_w(brzycki(actual_weight, actual_reps), target_reps),
        lombardi_w(lombardi(actual_weight, actual_reps), target_reps),
    ]
    return sum(estimates) / len(estimates)


def fmt_cell(v):
    if isinstance(v, str):
        return v
    if isinstance(v, int):
        return str(v)
    return f"{v:.2f}"


def actual_floor(target_reps):
    """Best weight you've actually done at >= target_reps. A forecast at this
    rep count can't sensibly be lower than this (you've already proved you
    can do at least this much)."""
    candidates = [w for (r, w) in DATA if r >= target_reps]
    return max(candidates) if candidates else None


def main():
    # Build one row per data point: [reps, actual, forecast@1, forecast@2, ...]
    rows = []
    for actual_reps, actual_weight in DATA:
        row = [actual_reps, actual_weight]
        for t in TARGET_REPS:
            row.append(forecast(actual_weight, actual_reps, t))
        rows.append(row)

    # Per-target summaries
    floor_row    = ["Floor",    "-"]
    avg_incl     = ["Avg incl", "-"]
    avg_excl     = ["Avg excl", "-"]
    final_estimate = ["Final",  "-"]
    for col_idx, t in enumerate(TARGET_REPS, start=2):
        incl_vals = [rows[i][col_idx] for i in range(len(DATA))]
        excl_vals = [rows[i][col_idx] for i in range(len(DATA)) if DATA[i][0] != t]
        floor = actual_floor(t)
        incl_avg = sum(incl_vals) / len(incl_vals)
        excl_avg = sum(excl_vals) / len(excl_vals) if excl_vals else None

        floor_row.append(floor if floor is not None else "-")
        avg_incl.append(incl_avg)
        avg_excl.append(excl_avg if excl_avg is not None else "-")
        # Final: clamp avg-incl at the floor — never report below what you've proven.
        if floor is None:
            final_estimate.append(incl_avg)
        else:
            final_estimate.append(max(floor, incl_avg))

    rows.extend([floor_row, avg_incl, avg_excl, final_estimate])

    header = ["Reps", "Actual"] + [f"@{t}r" for t in TARGET_REPS]

    # Format all cells, then compute column widths
    formatted = [header] + [[fmt_cell(c) for c in r] for r in rows]
    widths = [max(len(row[i]) for row in formatted) for i in range(len(header))]

    def line(row):
        return "  ".join(row[i].rjust(widths[i]) for i in range(len(header)))

    print(line(formatted[0]))
    print("-" * (sum(widths) + 2 * (len(header) - 1)))
    for r in formatted[1:-4]:
        print(line(r))
    print("-" * (sum(widths) + 2 * (len(header) - 1)))
    for r in formatted[-4:]:
        print(line(r))


if __name__ == "__main__":
    main()
