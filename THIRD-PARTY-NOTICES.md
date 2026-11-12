# Third-party notices

WalkMyCode is licensed under the GNU AGPL-3.0 (see `LICENSE`). It also uses the open-source parts below, each under
its own licence. This file covers the parts added for on-device speech to text (Settings → Voice → "On this computer
(Parakeet)") and for reading PDFs in Learn's "Course from a folder"; the complete, generated list for a packaged build
is still to come (docs/DISTRIBUTION.md).

## NVIDIA Parakeet-TDT 0.6B v2 (the speech model)

- What: the English speech-recognition model, in its int8 sherpa-onnx conversion
  (`sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8`). It is not part of this repository: WalkMyCode downloads it, when you
  ask, from the sherpa-onnx release page, or uses a copy already on the computer.
- Source: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2
- Licence: Creative Commons Attribution 4.0 International (CC-BY-4.0), https://creativecommons.org/licenses/by/4.0/
- Attribution, as shown in the app: "Speech model: NVIDIA Parakeet-TDT 0.6B v2, used under the CC-BY-4.0 licence, run
  with sherpa-onnx." The model is used unchanged apart from the conversion to ONNX and int8 quantisation done by the
  sherpa-onnx project.

## sherpa-onnx (the recognizer)

- What: the npm package `sherpa-onnx-node` and its per-platform package (`sherpa-onnx-win-x64`, `sherpa-onnx-linux-x64`,
  …), loaded by the WalkMyCode server to run the model.
- Source: https://github.com/k2-fsa/sherpa-onnx
- Licence: Apache License 2.0, https://www.apache.org/licenses/LICENSE-2.0
- Copyright (c) the sherpa-onnx authors (Xiaomi Corporation and contributors).

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this software except in compliance
with the License. Unless required by applicable law or agreed to in writing, software distributed under the License is
distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
License for the specific language governing permissions and limitations under the License.

## ONNX Runtime (inside the sherpa-onnx packages)

- What: `onnxruntime` (the shared library shipped in each per-platform sherpa-onnx package).
- Source: https://github.com/microsoft/onnxruntime
- Licence: MIT. Copyright (c) Microsoft Corporation.

## unbzip2-stream (unpacking the model's archive)

- What: the npm package `unbzip2-stream`, used to decompress the model's `.tar.bz2` in the WalkMyCode server.
- Source: https://github.com/regular/unbzip2-stream
- Licence: MIT. Copyright (c) 2017 by Jan Boelsche; based on bzip2.js, copyright 2011 by antimatter15; based on
  micro-bunzip by Rob Landley.

## unpdf (reading the text of a PDF)

- What: the npm package `unpdf`, used by the WalkMyCode server to read the text of PDF files in a course folder
  (Learn → Course from a folder). It is used unchanged.
- Source: https://github.com/unjs/unpdf
- Licence: MIT. Copyright (c) 2023-PRESENT Johann Schopplich.

## PDF.js (inside unpdf)

- What: Mozilla's PDF reader, a build of which is bundled inside the `unpdf` package and does the reading.
- Source: https://github.com/mozilla/pdf.js
- Licence: Apache License 2.0, https://www.apache.org/licenses/LICENSE-2.0 (the notice under sherpa-onnx above applies
  to it as well). Copyright (c) Mozilla Foundation and the PDF.js contributors.

## The MIT License (ONNX Runtime, unbzip2-stream, unpdf)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
