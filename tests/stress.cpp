#include "fast_eval.hpp"
#include <algorithm>
#include <iostream>
#include <numeric>
#include <random>
#include <cmath>

int main() {
    poker::initialize_omaha_table();
    std::mt19937_64 rng(6116); std::array<poker::Card, 52> deck;
    std::iota(deck.begin(), deck.end(), 0);
    for (unsigned test = 0; test < 100000; ++test) {
        for (unsigned j = 0; j < 9; ++j) {
            unsigned k = std::uniform_int_distribution<unsigned>(j, 51)(rng);
            std::swap(deck[j], deck[k]);
        }
        if (poker::evaluate_high(deck.data(), 7) != poker::evaluate_high_reference(deck.data(), 7)) {
            std::cerr << "Seven-card stress mismatch\n"; return 1;
        }
        auto actual = poker::evaluate_prepared(poker::Game::Omaha8,
            poker::prepare_hole(poker::Game::Omaha8, deck.data()),
            poker::prepare_board(poker::Game::Omaha8, deck.data() + 4));
        poker::Value expected{0, 0}; poker::Card five[5];
        for (unsigned a = 0; a < 3; ++a) for (unsigned b = a + 1; b < 4; ++b) {
            five[0] = deck[a]; five[1] = deck[b];
            for (unsigned x = 4; x < 7; ++x) for (unsigned y = x + 1; y < 8; ++y)
                for (unsigned z = y + 1; z < 9; ++z) {
                    five[2] = deck[x]; five[3] = deck[y]; five[4] = deck[z];
                    expected.high = std::max(expected.high, poker::evaluate_high_reference(five, 5));
                    auto low = poker::evaluate_low(five);
                    if (low && (!expected.low || low < expected.low)) expected.low = low;
                }
        }
        if (actual.high != expected.high || actual.low != expected.low) {
            std::cerr << "Direct Omaha high/low stress mismatch\n"; return 1;
        }
    }
    poker::Range hero{{(1ULL << 51) | (1ULL << 50), 2}, {(1ULL << 47) | (1ULL << 46), 1}};
    poker::Range villain{{(1ULL << 51) | (1ULL << 49), 3}, {(1ULL << 43) | (1ULL << 41), 1}};
    poker::Options opt; opt.exact = true;
    auto exact = poker::simulate(std::vector<poker::Range>{hero, villain}, {0, 5, 10, 27, 28}, {}, opt);
    if (exact.outcomes != 3 || std::abs(exact.players[0].equity - .5) > 1e-12) return 1;
    opt.exact = false; opt.threads = 4; opt.samples = 10000; opt.seed = 912;
    auto mc = poker::simulate(std::vector<poker::Range>{hero, villain}, {0, 5, 10, 27, 28}, {}, opt);
    if (mc.outcomes != 10000 || std::abs(mc.players[0].equity - .5) > .03) return 1;
    std::cout << "Verified 100,000 random seven-card and direct Omaha high/low hands, weighted enumeration, and threaded simulation.\n";
}
