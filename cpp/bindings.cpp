#define PY_SSIZE_T_CLEAN
#include <Python.h>
#include "engine.hpp"
#include "fast_eval.hpp"
#include <exception>
#include <stdexcept>
#include <string>
#include <memory>

namespace {
struct PyDelete { void operator()(PyObject* p) const { Py_XDECREF(p); } };
using Ref = std::unique_ptr<PyObject, PyDelete>;
struct PythonError {};
Ref sequence(PyObject* obj, const char* message) {
    Ref p(PySequence_Fast(obj, message)); if (!p) throw PythonError{}; return p;
}
uint64_t integer(PyObject* obj) {
    auto v = PyLong_AsUnsignedLongLong(obj); if (PyErr_Occurred()) throw PythonError{}; return v;
}
std::vector<poker::Card> cards(PyObject* obj) {
    auto seq = sequence(obj, "Cards must be a sequence of integer IDs");
    std::vector<poker::Card> out; poker::Mask mask = 0;
    for (Py_ssize_t i = 0; i < PySequence_Fast_GET_SIZE(seq.get()); ++i) {
        auto c = integer(PySequence_Fast_GET_ITEM(seq.get(), i));
        if (c >= 52 || (mask & (poker::Mask(1) << c))) throw std::invalid_argument("Invalid or duplicate card ID");
        mask |= poker::Mask(1) << c; out.push_back(poker::Card(c));
    }
    return out;
}
poker::Game game(unsigned g) {
    if (g > 2) throw std::invalid_argument("Game ID must be 0, 1, or 2");
    return static_cast<poker::Game>(g);
}
PyObject* error() {
    try { throw; }
    catch (const PythonError&) { return nullptr; }
    catch (const std::invalid_argument& e) { PyErr_SetString(PyExc_ValueError, e.what()); }
    catch (const std::bad_alloc&) { PyErr_NoMemory(); }
    catch (const std::exception& e) { PyErr_SetString(PyExc_RuntimeError, e.what()); }
    catch (...) { PyErr_SetString(PyExc_RuntimeError, "Unknown native engine error"); }
    return nullptr;
}
struct ReleaseGIL {
    PyThreadState* state;
    ReleaseGIL() : state(PyEval_SaveThread()) {}
    ~ReleaseGIL() { PyEval_RestoreThread(state); }
};
poker::Range numeric_range(PyObject* obj) {
    auto combos = sequence(obj, "Range must contain (mask, weight) pairs"); poker::Range range;
    range.reserve(size_t(PySequence_Fast_GET_SIZE(combos.get())));
    for (Py_ssize_t j = 0; j < PySequence_Fast_GET_SIZE(combos.get()); ++j) {
        auto pair = sequence(PySequence_Fast_GET_ITEM(combos.get(), j), "Combo must be (mask, weight)");
        if (PySequence_Fast_GET_SIZE(pair.get()) != 2) throw std::invalid_argument("Combo must have two elements");
        auto mask = integer(PySequence_Fast_GET_ITEM(pair.get(), 0));
        double weight = PyFloat_AsDouble(PySequence_Fast_GET_ITEM(pair.get(), 1));
        if (PyErr_Occurred()) throw PythonError{};
        range.push_back({mask, weight});
    }
    return range;
}
constexpr const char* RANGE_CAPSULE = "poker_engine.Range.v1";
void delete_range(PyObject* capsule) {
    delete static_cast<poker::CompiledRangePtr*>(PyCapsule_GetPointer(capsule, RANGE_CAPSULE));
}
PyObject* compile_range(PyObject*, PyObject* args) {
    PyObject* r; unsigned g;
    if (!PyArg_ParseTuple(args, "IO", &g, &r)) return nullptr;
    try {
        auto numeric = numeric_range(r); auto selected_game = game(g); poker::CompiledRangePtr compiled;
        { ReleaseGIL released; compiled = poker::compile_range(numeric, selected_game); }
        auto owner = std::make_unique<poker::CompiledRangePtr>(std::move(compiled));
        PyObject* capsule = PyCapsule_New(owner.get(), RANGE_CAPSULE, delete_range);
        if (capsule) owner.release();
        return capsule;
    } catch (...) { return error(); }
}
PyObject* high(PyObject*, PyObject* obj) {
    try {
        auto c = cards(obj); return PyLong_FromUnsignedLong(poker::evaluate_high(c.data(), unsigned(c.size())));
    } catch (...) { return error(); }
}
PyObject* initialize_omaha(PyObject*, PyObject* obj) {
    try {
        if (!PyBytes_Check(obj)) throw std::invalid_argument("Omaha lookup must be numeric table bytes");
        if (size_t(PyBytes_GET_SIZE(obj)) != poker::OMAHA_TABLE_SIZE * 2)
            throw std::invalid_argument("Invalid Omaha lookup byte count");
        const auto* bytes = reinterpret_cast<const unsigned char*>(PyBytes_AS_STRING(obj));
        std::vector<uint16_t> values(poker::OMAHA_TABLE_SIZE);
        for (size_t i = 0; i < values.size(); ++i) values[i] = uint16_t(bytes[2 * i] | (unsigned(bytes[2 * i + 1]) << 8));
        poker::initialize_omaha_table(values.data(), values.size());
        Py_RETURN_NONE;
    } catch (...) { return error(); }
}
PyObject* evaluate(PyObject*, PyObject* args) {
    PyObject *h, *b; unsigned g;
    if (!PyArg_ParseTuple(args, "IOO", &g, &h, &b)) return nullptr;
    try {
        auto hole = cards(h), board = cards(b); poker::Mask used = 0;
        for (auto c : hole) used |= poker::Mask(1) << c;
        for (auto c : board) if (used & (poker::Mask(1) << c)) throw std::invalid_argument("Hole cards overlap board");
        auto v = poker::evaluate(game(g), hole, board);
        return Py_BuildValue("II", v.high, v.low);
    } catch (...) { return error(); }
}
PyObject* simulate(PyObject*, PyObject* args) {
    PyObject *r, *b, *d; unsigned g, workers; int exact;
    unsigned long long samples, seed, max_exact, max_attempts;
    if (!PyArg_ParseTuple(args, "OOOIpKKKKI", &r, &b, &d, &g, &exact,
                         &samples, &seed, &max_exact, &max_attempts, &workers)) return nullptr;
    try {
        auto board = cards(b), dead = cards(d);
        auto rs = sequence(r, "Ranges must be a sequence"); std::vector<poker::CompiledRangePtr> ranges;
        for (Py_ssize_t i = 0; i < PySequence_Fast_GET_SIZE(rs.get()); ++i) {
            auto item = PySequence_Fast_GET_ITEM(rs.get(), i);
            if (PyCapsule_IsValid(item, RANGE_CAPSULE)) {
                ranges.push_back(*static_cast<poker::CompiledRangePtr*>(PyCapsule_GetPointer(item, RANGE_CAPSULE)));
            } else {
                ranges.push_back(poker::compile_range(numeric_range(item), game(g)));
            }
        }
        poker::Options opt; opt.game = game(g); opt.exact = exact;
        opt.samples = samples; opt.seed = seed; opt.max_exact = max_exact;
        opt.max_attempts = max_attempts; opt.threads = workers;
        poker::Result result;
        { ReleaseGIL released; result = poker::simulate(std::move(ranges), board, dead, opt); }
        if (PyErr_CheckSignals() < 0) return nullptr;
        Ref players(PyList_New(Py_ssize_t(result.players.size())));
        if (!players) throw PythonError{};
        for (size_t i = 0; i < result.players.size(); ++i) {
            const auto& p = result.players[i];
            PyObject* row = Py_BuildValue("{s:d,s:d,s:d,s:d,s:d,s:d,s:d,s:d,s:d}",
                "equity", p.equity, "stderr", p.stderr, "win", p.win, "tie", p.tie, "loss", p.loss,
                "high_win", p.high_win, "high_tie", p.high_tie, "low_win", p.low_win, "low_tie", p.low_tie);
            if (!row) throw PythonError{};
            PyList_SET_ITEM(players.get(), Py_ssize_t(i), row);
        }
        return Py_BuildValue("{s:O,s:K,s:K,s:d}", "players", players.get(), "outcomes", result.outcomes,
                             "attempts", result.attempts, "total_weight", result.total_weight);
    } catch (...) { return error(); }
}
PyMethodDef methods[] = {
    {"compile_range", compile_range, METH_VARARGS, "Compile numeric masks and weights for reuse."},
    {"initialize_omaha", initialize_omaha, METH_O, "Load a numeric direct Omaha lookup table."},
    {"evaluate_high", high, METH_O, "Evaluate 5..7 numeric cards; higher score wins."},
    {"evaluate", evaluate, METH_VARARGS, "Evaluate numeric game, hole cards, board."},
    {"simulate", simulate, METH_VARARGS, "Compute equity from numeric masks and weights."},
    {nullptr, nullptr, 0, nullptr}
};
PyModuleDef module = {PyModuleDef_HEAD_INIT, "_native", "Numeric poker engine; no text parsing.", -1,
                      methods, nullptr, nullptr, nullptr, nullptr};
}
#ifdef POKER_CPP_REFERENCE
PyMODINIT_FUNC PyInit__cpp_reference() { return PyModule_Create(&module); }
#else
PyMODINIT_FUNC PyInit__native() { return PyModule_Create(&module); }
#endif
