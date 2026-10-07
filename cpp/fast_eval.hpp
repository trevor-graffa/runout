#pragma once
#include "engine.hpp"
#include "vendor/ompeval/HandEvaluator.h"
#include <cstddef>

namespace poker {
// Immutable partial-hand data is shared by simulation workers.
struct FastHole {
    omp::Hand high;
    unsigned rank_hash = 0;
    std::array<unsigned, 4> suits{};
    unsigned low_mask = 0;
};
struct FastBoard {
    omp::Hand high;
    unsigned rank_hash = 0;
    std::array<unsigned, 4> suits{};
    unsigned low_mask = 0;
};
omp::HandEvaluator& fast_evaluator();
uint32_t translate_high(uint16_t score);
FastHole prepare_hole(Game game, const Card* cards);
FastBoard prepare_board(Game game, const Card* cards);
Value evaluate_prepared(Game game, const FastHole& hole, const FastBoard& board);
// Direct Omaha no-flush lookup, generated from rank multisets rather than physical deals.
constexpr size_t OMAHA_TABLE_SIZE = 6175 * 1820;
std::vector<uint16_t> generate_omaha_table();
void initialize_omaha_table(const uint16_t* values = nullptr, size_t count = 0);
uint32_t evaluate_high_reference(const Card* cards, unsigned n);
} // namespace poker
