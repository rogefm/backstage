/*
 * Copyright 2022 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
  useAnalytics,
  useApiHolder,
  useRouteRefParams,
} from '@backstage/core-plugin-api';
import { JsonValue } from '@backstage/types';
import {
  Stepper as MuiStepper,
  Step as MuiStep,
  StepLabel as MuiStepLabel,
  Button,
  makeStyles,
} from '@material-ui/core';
import { withTheme } from '@rjsf/core-v5';
import { ErrorSchema, FieldValidation } from '@rjsf/utils';
import React, { useMemo, useState } from 'react';
import { NextFieldExtensionOptions } from '../../../extensions';
import { TemplateParameterSchema } from '../../../types';
import { createAsyncValidators } from './createAsyncValidators';
import { useTemplateSchema } from './useTemplateSchema';
import { ReviewState } from './ReviewState';
import validator from '@rjsf/validator-ajv8';
import { selectedTemplateRouteRef } from '../../../routes';
import { getDefaultFormState } from '@rjsf/utils';
import { useFormData } from './useFormData';
import { FormProps } from '../../types';

const useStyles = makeStyles(theme => ({
  backButton: {
    marginRight: theme.spacing(1),
  },

  footer: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'right',
  },
  formWrapper: {
    padding: theme.spacing(2),
  },
}));

export type StepperProps = {
  manifest: TemplateParameterSchema;
  extensions: NextFieldExtensionOptions<any, any>[];
  onComplete: (values: Record<string, JsonValue>) => Promise<void>;
  FormProps?: FormProps;
};

// TODO(blam): We require here, as the types in this package depend on @rjsf/core explicitly
// which is what we're using here as the default types, it needs to depend on @rjsf/core-v5 because
// of the re-writing we're doing. Once we've migrated, we can import this the exact same as before.
const Form = withTheme(require('@rjsf/material-ui-v5').Theme);

export const Stepper = (props: StepperProps) => {
  const { templateName } = useRouteRefParams(selectedTemplateRouteRef);
  const analytics = useAnalytics();
  const { steps } = useTemplateSchema(props.manifest);
  const apiHolder = useApiHolder();
  const [activeStep, setActiveStep] = useState(0);
  const [formState, setFormState] = useFormData();

  const [errors, setErrors] = useState<
    undefined | Record<string, FieldValidation>
  >();
  const styles = useStyles();

  const extensions = useMemo(() => {
    return Object.fromEntries(
      props.extensions.map(({ name, component }) => [name, component]),
    );
  }, [props.extensions]);

  const validators = useMemo(() => {
    return Object.fromEntries(
      props.extensions.map(({ name, validation }) => [name, validation]),
    );
  }, [props.extensions]);

  const validation = useMemo(() => {
    return createAsyncValidators(steps[activeStep]?.mergedSchema, validators, {
      apiHolder,
    });
  }, [steps, activeStep, validators, apiHolder]);

  const handleBack = () => {
    setActiveStep(prevActiveStep => prevActiveStep - 1);
  };

  const handleNext = async ({
    formData,
  }: {
    formData: Record<string, JsonValue>;
  }) => {
    // TODO(blam): What do we do about loading states, does each field extension get a chance
    // to display it's own loading? Or should we grey out the entire form.
    setErrors(undefined);

    const schema = steps[activeStep]?.schema;
    const rootSchema = steps[activeStep]?.mergedSchema;

    const newFormData = getDefaultFormState(
      validator,
      schema,
      formData,
      rootSchema,
      true,
    );

    const returnedValidation = await validation(newFormData);

    const hasErrors = Object.values(returnedValidation).some(
      i => i.__errors?.length,
    );

    if (hasErrors) {
      setErrors(returnedValidation);
    } else {
      setErrors(undefined);
      setActiveStep(prevActiveStep => {
        const stepNum = prevActiveStep + 1;
        analytics.captureEvent('click', `Next Step (${stepNum})`);
        return stepNum;
      });
    }
    setFormState(current => ({ ...current, ...newFormData }));
  };

  return (
    <>
      <MuiStepper activeStep={activeStep} alternativeLabel variant="elevation">
        {steps.map((step, index) => (
          <MuiStep key={index}>
            <MuiStepLabel>{step.title}</MuiStepLabel>
          </MuiStep>
        ))}
        <MuiStep>
          <MuiStepLabel>Review</MuiStepLabel>
        </MuiStep>
      </MuiStepper>
      <div className={styles.formWrapper}>
        {activeStep < steps.length ? (
          <Form
            validator={validator}
            extraErrors={errors as unknown as ErrorSchema}
            formData={formState}
            formContext={{ formData: formState }}
            schema={steps[activeStep].schema}
            uiSchema={steps[activeStep].uiSchema}
            onSubmit={handleNext}
            fields={extensions}
            showErrorList={false}
            {...(props.FormProps ?? {})}
          >
            <div className={styles.footer}>
              <Button
                onClick={handleBack}
                className={styles.backButton}
                disabled={activeStep < 1}
              >
                Back
              </Button>
              <Button variant="contained" color="primary" type="submit">
                {activeStep === steps.length - 1 ? 'Review' : 'Next'}
              </Button>
            </div>
          </Form>
        ) : (
          <>
            <ReviewState formState={formState} schemas={steps} />
            <div className={styles.footer}>
              <Button
                onClick={handleBack}
                className={styles.backButton}
                disabled={activeStep < 1}
              >
                Back
              </Button>
              <Button
                variant="contained"
                onClick={() => {
                  props.onComplete(formState);
                  const name =
                    typeof formState.name === 'string'
                      ? formState.name
                      : undefined;
                  analytics.captureEvent(
                    'create',
                    name || `new ${templateName}`,
                  );
                }}
              >
                Create
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
};
