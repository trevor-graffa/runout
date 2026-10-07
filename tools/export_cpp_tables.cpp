// One-time bridge: export the existing, verified C++ numeric tables for Rust.
// This introspection macro is confined to this development tool, never the core.
#include <memory>
#include <array>
#include <limits>
#include <cassert>
#include <cstdint>
#include <fstream>
#define private public
#include "vendor/ompeval/HandEvaluator.h"
#undef private
#include "fast_eval.cpp"

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    auto& scores = poker::scores();
    std::ofstream out(argv[1], std::ios::binary);
    out.write("PKE1", 4);
    auto write = [&](auto& array) {
        for (auto value : array) for (unsigned i = 0; i < sizeof(value); ++i)
            out.put(char((value >> (8 * i)) & 255));
    };
    write(omp::HandEvaluator::RANKS);
    write(omp::HandEvaluator::PERF_HASH_ROW_OFFSETS);
    write(omp::HandEvaluator::LOOKUP);
    write(omp::HandEvaluator::FLUSH_LOOKUP);
    write(scores.translation); write(scores.rank4); write(scores.rank5); write(scores.low);
    return out ? 0 : 1;
}
