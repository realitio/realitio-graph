import { crypto, log, BigInt, Bytes, ByteArray } from '@graphprotocol/graph-ts'

import { unescape } from './utils/unescape'

import { 
    Question,
    Answer,
    Category,
} from '../generated/schema'

import {
  LogNewQuestion,
  LogNewAnswer,
  LogNotifyOfArbitrationRequest,
  LogFinalize,
  LogAnswerReveal,
} from '../generated/Realitio/Realitio'

export function handleNewQuestion(event: LogNewQuestion): void {
  let questionId = event.params.question_id.toHexString();
  let question = new Question(questionId);
  let templateId = event.params.template_id
  let templateIdI32 = templateId.toI32();
  if (templateIdI32 == 2) {
    question.templateId = templateId;

    let data = event.params.question;
    question.data = data;
  
    let fields = data.split('\u241f', 4);
  
    if (fields.length >= 1) {
      question.title = unescape(fields[0]);
      if (fields.length >= 2) {
        let outcomesData = fields[1];
        let start = -1;
        let escaped = false
        let outcomes = new Array<string>(0);
        for (let i = 0; i < outcomesData.length; i++) {
          if (escaped) {
            escaped = false;
          } else {
            if (outcomesData[i] == '"') {
              if (start == -1) {
                start = i + 1;
              } else {
                outcomes.push(unescape(outcomesData.slice(start, i)));
                start = -1;
              }
            } else if (outcomesData[i] == '\\') {
              escaped = true;
            }
          }
        }
        question.outcomes = outcomes;
        if (fields.length >= 3) {
          let categoryId = unescape(fields[2])
          question.category = categoryId;
          let category = Category.load(categoryId);
          if (category == null) {
            category = new Category(categoryId);
            category.numConditions = 0;
            category.numOpenConditions = 0;
            category.numClosedConditions = 0;
            category.save();
          }

          if (fields.length >= 4) {
            question.language = unescape(fields[3]);
          }
        }
      }
    }
  } else {
    log.info('ignoring question {} with template ID {}', [
      questionId,
      templateId.toString(),
    ]);
    return;
  }

  question.arbitrator = event.params.arbitrator;
  question.openingTimestamp = event.params.opening_ts;
  question.timeout = event.params.timeout;

  question.isPendingArbitration = false;
  question.arbitrationOccurred = false;

  question.save();
}

function saveNewAnswer(questionId: string, answer: Bytes, bond: BigInt, ts: BigInt): void {
  let question = Question.load(questionId);
  if (question == null) {
    log.info('cannot find question {} to answer', [questionId]);
    return;
  }

  let answerId = questionId + '_' + answer.toHexString();
  let answerEntity = Answer.load(answerId);
  if(answerEntity == null) {
    answerEntity = new Answer(answerId);
    answerEntity.question = questionId;
    answerEntity.answer = answer;
    answerEntity.bondAggregate = bond;
    answerEntity.timestamp = ts;
    answerEntity.save();
  } else {
    answerEntity.bondAggregate = answerEntity.bondAggregate.plus(bond);
    answerEntity.timestamp = ts;
    answerEntity.save();
  }

  let answerFinalizedTimestamp = question.arbitrationOccurred ? ts : ts.plus(question.timeout);

  question.currentAnswer = answer;
  question.currentAnswerBond = bond;
  question.currentAnswerTimestamp = ts;
  question.answerFinalizedTimestamp = answerFinalizedTimestamp;

  question.save();

}

export function handleNewAnswer(event: LogNewAnswer): void {
  if (event.params.is_commitment) {
    // only record confirmed answers
    return;
  }

  let questionId = event.params.question_id.toHexString();
  saveNewAnswer(questionId, event.params.answer, event.params.bond, event.params.ts);
}

export function handleAnswerReveal(event: LogAnswerReveal): void {
  let questionId = event.params.question_id.toHexString();
  saveNewAnswer(questionId, event.params.answer, event.params.bond, event.block.timestamp);
}

export function handleArbitrationRequest(event: LogNotifyOfArbitrationRequest): void {
  let questionId = event.params.question_id.toHexString()
  let question = Question.load(questionId);
  if (question == null) {
    log.info('cannot find question {} to begin arbitration', [questionId]);
    return;
  }

  question.isPendingArbitration = true;
  question.answerFinalizedTimestamp = null;
  question.arbitrationRequestedTimestamp = event.block.timestamp;
  question.arbitrationRequestedBy = event.params.user.toHexString();

  question.save();

}

export function handleFinalize(event: LogFinalize): void {
  let questionId = event.params.question_id.toHexString()
  let question = Question.load(questionId);
  if (question == null) {
    log.info('cannot find question {} to finalize', [questionId]);
    return;
  }

  question.isPendingArbitration = false;
  question.arbitrationOccurred = true;
  question.currentAnswer = event.params.answer;

  question.save();

}
